import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostgresWhaleWalletRepository } from '../../infrastructure/db/PostgresWhaleWalletRepository.js';

const { Pool } = pg;

const TOKEN_ADDRESS = '0x17205fab260a7a6383a81452cE6315A39370Db97';
const ADDRESS       = '0xAbCd1234567890abcdef1234567890ABCDEF1234';

describe('PostgresWhaleWalletRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: PostgresWhaleWalletRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });

    const schema = readFileSync(
      join(process.cwd(), 'src/infrastructure/db/schema.sql'),
      'utf-8'
    );
    await pool.query(schema);

    repository = new PostgresWhaleWalletRepository(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM whale_wallets');
  });

  describe('findByAddress()', () => {
    it('등록된 주소와 토큰으로 조회하면 WhaleWallet을 반환한다', async () => {
      // given
      const label = '세력 지갑 A';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, label) VALUES ($1, $2, $3)',
        [ADDRESS, TOKEN_ADDRESS, label]
      );

      // when
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).not.toBeNull();
      expect(result!.address).toBe(ADDRESS);
      expect(result!.tokenAddress).toBe(TOKEN_ADDRESS);
      expect(result!.label).toBe(label);
      expect(result!.isActive).toBe(true);
    });

    it('등록되지 않은 주소로 조회하면 null을 반환한다', async () => {
      // given / when
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).toBeNull();
    });

    it('주소가 같아도 다른 토큰이면 null을 반환한다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address) VALUES ($1, $2)',
        [ADDRESS, OTHER_TOKEN]
      );

      // when
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).toBeNull();
    });

    it('is_active가 false인 지갑도 조회된다', async () => {
      // given
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, is_active) VALUES ($1, $2, FALSE)',
        [ADDRESS, TOKEN_ADDRESS]
      );

      // when
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).not.toBeNull();
      expect(result!.isActive).toBe(false);
    });
  });

  describe('findAllByToken()', () => {
    it('해당 토큰의 활성 지갑 전체를 반환한다', async () => {
      // given
      const ADDRESS_2 = '0x1234567890abcdef1234567890ABCDEF12345678';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address) VALUES ($1, $2), ($3, $4)',
        [ADDRESS, TOKEN_ADDRESS, ADDRESS_2, TOKEN_ADDRESS]
      );

      // when
      const result = await repository.findAllByToken(TOKEN_ADDRESS);

      // then
      expect(result).toHaveLength(2);
      expect(result.every(w => w.tokenAddress === TOKEN_ADDRESS)).toBe(true);
    });

    it('is_active가 false인 지갑은 반환하지 않는다', async () => {
      // given
      const ADDRESS_2 = '0x1234567890abcdef1234567890ABCDEF12345678';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, is_active) VALUES ($1, $2, TRUE), ($3, $4, FALSE)',
        [ADDRESS, TOKEN_ADDRESS, ADDRESS_2, TOKEN_ADDRESS]
      );

      // when
      const result = await repository.findAllByToken(TOKEN_ADDRESS);

      // then
      expect(result).toHaveLength(1);
      expect(result[0].address).toBe(ADDRESS);
    });

    it('다른 토큰의 지갑은 반환하지 않는다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address) VALUES ($1, $2), ($1, $3)',
        [ADDRESS, TOKEN_ADDRESS, OTHER_TOKEN]
      );

      // when
      const result = await repository.findAllByToken(TOKEN_ADDRESS);

      // then
      expect(result).toHaveLength(1);
      expect(result[0].tokenAddress).toBe(TOKEN_ADDRESS);
    });
  });

  describe('upsert()', () => {
    it('새 지갑을 삽입하고 is_active = TRUE로 저장한다', async () => {
      // when
      await repository.upsert(ADDRESS, TOKEN_ADDRESS, 'Top 1 Holder');

      // then
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Top 1 Holder');
      expect(result!.isActive).toBe(true);
    });

    it('이미 존재하는 지갑은 label을 업데이트하고 is_active를 TRUE로 복구한다', async () => {
      // given — 비활성 상태로 먼저 삽입
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, label, is_active) VALUES ($1, $2, $3, FALSE)',
        [ADDRESS, TOKEN_ADDRESS, 'Old Label']
      );

      // when
      await repository.upsert(ADDRESS, TOKEN_ADDRESS, 'New Label');

      // then
      const result = await repository.findByAddress(ADDRESS, TOKEN_ADDRESS);
      expect(result!.label).toBe('New Label');
      expect(result!.isActive).toBe(true);
    });
  });

  describe('deactivateExcept()', () => {
    it('activeAddresses에 없는 지갑을 is_active = FALSE로 처리한다', async () => {
      // given
      const ADDRESS_2 = '0x1234567890abcdef1234567890ABCDEF12345678';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, is_active) VALUES ($1, $2, TRUE), ($3, $4, TRUE)',
        [ADDRESS, TOKEN_ADDRESS, ADDRESS_2, TOKEN_ADDRESS]
      );

      // when — ADDRESS만 유지, ADDRESS_2는 제외
      await repository.deactivateExcept(TOKEN_ADDRESS, [ADDRESS]);

      // then
      const kept    = await repository.findByAddress(ADDRESS,   TOKEN_ADDRESS);
      const removed = await repository.findByAddress(ADDRESS_2, TOKEN_ADDRESS);
      expect(kept!.isActive).toBe(true);
      expect(removed!.isActive).toBe(false);
    });

    it('다른 토큰의 지갑은 영향을 받지 않는다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await pool.query(
        'INSERT INTO whale_wallets (address, token_address, is_active) VALUES ($1, $2, TRUE), ($1, $3, TRUE)',
        [ADDRESS, TOKEN_ADDRESS, OTHER_TOKEN]
      );

      // when — TOKEN_ADDRESS 기준으로만 비활성화
      await repository.deactivateExcept(TOKEN_ADDRESS, []);

      // then — OTHER_TOKEN 지갑은 여전히 활성
      const otherTokenWallet = await repository.findByAddress(ADDRESS, OTHER_TOKEN);
      expect(otherTokenWallet!.isActive).toBe(true);
    });
  });
});
