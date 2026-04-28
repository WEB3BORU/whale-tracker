import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostgresSyncStateRepository } from '../../infrastructure/db/PostgresSyncStateRepository.js';

const { Pool } = pg;

const TOKEN_ADDRESS = '0x17205fab260a7a6383a81452cE6315A39370Db97';

describe('PostgresSyncStateRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: PostgresSyncStateRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });

    const schema = readFileSync(
      join(process.cwd(), 'src/infrastructure/db/schema.sql'),
      'utf-8'
    );
    await pool.query(schema);

    repository = new PostgresSyncStateRepository(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM sync_state');
  });

  describe('getOrCreate()', () => {
    it('처음 호출하면 초기 상태를 생성해 반환한다', async () => {
      // given / when
      const state = await repository.getOrCreate(TOKEN_ADDRESS);

      // then
      expect(state.tokenAddress).toBe(TOKEN_ADDRESS);
      expect(state.lastProcessedBlock).toBe(0n);
      expect(state.batchSyncedBlock).toBeNull();
      expect(state.isSyncing).toBe(false);
    });

    it('이미 존재하면 기존 상태를 반환한다', async () => {
      // given
      await repository.getOrCreate(TOKEN_ADDRESS);
      await repository.setSyncing(TOKEN_ADDRESS, true);

      // when
      const state = await repository.getOrCreate(TOKEN_ADDRESS);

      // then — 기존 상태 유지
      expect(state.isSyncing).toBe(true);
    });
  });

  describe('setSyncing()', () => {
    it('is_syncing을 true로 설정한다', async () => {
      // given
      await repository.getOrCreate(TOKEN_ADDRESS);

      // when
      await repository.setSyncing(TOKEN_ADDRESS, true);

      // then
      const state = await repository.getOrCreate(TOKEN_ADDRESS);
      expect(state.isSyncing).toBe(true);
    });

    it('is_syncing을 false로 복구한다', async () => {
      // given
      await repository.getOrCreate(TOKEN_ADDRESS);
      await repository.setSyncing(TOKEN_ADDRESS, true);

      // when
      await repository.setSyncing(TOKEN_ADDRESS, false);

      // then
      const state = await repository.getOrCreate(TOKEN_ADDRESS);
      expect(state.isSyncing).toBe(false);
    });
  });

  describe('updateBatchSyncedBlock()', () => {
    it('batch_synced_block을 업데이트한다', async () => {
      // given
      await repository.getOrCreate(TOKEN_ADDRESS);

      // when
      await repository.updateBatchSyncedBlock(TOKEN_ADDRESS, 19_000_000n);

      // then
      const state = await repository.getOrCreate(TOKEN_ADDRESS);
      expect(state.batchSyncedBlock).toBe(19_000_000n);
    });
  });

  describe('updateLastProcessedBlock()', () => {
    it('last_processed_block을 업데이트한다', async () => {
      // given
      await repository.getOrCreate(TOKEN_ADDRESS);

      // when
      await repository.updateLastProcessedBlock(TOKEN_ADDRESS, 19_500_000n);

      // then
      const state = await repository.getOrCreate(TOKEN_ADDRESS);
      expect(state.lastProcessedBlock).toBe(19_500_000n);
    });
  });
});
