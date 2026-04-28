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
});
