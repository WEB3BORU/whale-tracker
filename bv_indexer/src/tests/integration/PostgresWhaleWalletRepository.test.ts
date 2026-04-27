import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostgresWhaleWalletRepository } from '../../infrastructure/db/PostgresWhaleWalletRepository.js';

const { Pool } = pg;

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
    it('등록된 주소로 조회하면 WhaleWallet을 반환한다', async () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
      const label = '세력 지갑 A';
      await pool.query(
        'INSERT INTO whale_wallets (address, label) VALUES ($1, $2)',
        [address, label]
      );

      // when
      const result = await repository.findByAddress(address);

      // then
      expect(result).not.toBeNull();
      expect(result!.address).toBe(address);
      expect(result!.label).toBe(label);
      expect(result!.isActive).toBe(true);
    });

    it('등록되지 않은 주소로 조회하면 null을 반환한다', async () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';

      // when
      const result = await repository.findByAddress(address);

      // then
      expect(result).toBeNull();
    });

    it('is_active가 false인 지갑도 조회된다', async () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
      await pool.query(
        'INSERT INTO whale_wallets (address, is_active) VALUES ($1, FALSE)',
        [address]
      );

      // when
      const result = await repository.findByAddress(address);

      // then
      expect(result).not.toBeNull();
      expect(result!.isActive).toBe(false);
    });
  });
});
