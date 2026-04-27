import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostgresExchangeAddressRepository } from '../../infrastructure/db/PostgresExchangeAddressRepository.js';

const { Pool } = pg;

describe('PostgresExchangeAddressRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: PostgresExchangeAddressRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    pool = new Pool({ connectionString: container.getConnectionUri() });

    const schema = readFileSync(
      join(process.cwd(), 'src/infrastructure/db/schema.sql'),
      'utf-8'
    );
    await pool.query(schema);

    repository = new PostgresExchangeAddressRepository(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM exchange_addresses');
  });

  describe('isExchange()', () => {
    it('거래소로 등록된 주소면 true를 반환한다', async () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';
      await pool.query(
        'INSERT INTO exchange_addresses (address, name) VALUES ($1, $2)',
        [address, 'Binance Hot Wallet']
      );

      // when
      const result = await repository.isExchange(address);

      // then
      expect(result).toBe(true);
    });

    it('등록되지 않은 주소면 false를 반환한다', async () => {
      // given
      const address = '0xAbCd1234567890abcdef1234567890ABCDEF1234';

      // when
      const result = await repository.isExchange(address);

      // then
      expect(result).toBe(false);
    });
  });
});
