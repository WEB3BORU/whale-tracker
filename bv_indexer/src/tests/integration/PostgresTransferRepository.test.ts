import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PostgresTransferRepository } from '../../infrastructure/db/PostgresTransferRepository.js';
import { Transfer } from '../../domain/entities/Transfer.js';

const { Pool } = pg;

const TOKEN_ADDRESS    = '0x17205fab260a7a6383a81452cE6315A39370Db97';
const WHALE_ADDRESS    = '0xAAAA000000000000000000000000000000000001';
const EXCHANGE_ADDRESS = '0xBBBB000000000000000000000000000000000002';
const NORMAL_ADDRESS   = '0xCCCC000000000000000000000000000000000003';

function makeTxHash(suffix: string): string {
  return `0x${suffix.padStart(64, '0')}`;
}

function makeTransfer(overrides: Partial<{
  txHash: string;
  logIndex: number;
  tokenAddress: string;
  from: string;
  to: string;
  value: bigint;
  blockTimestamp: Date;
  toType: 'exchange' | 'unknown';
}> = {}): Transfer {
  return Transfer.create({
    txHash:        makeTxHash('abc1'),
    logIndex:      0,
    tokenAddress:  TOKEN_ADDRESS,
    from:          WHALE_ADDRESS,
    to:            EXCHANGE_ADDRESS,
    value:         1_000_000n,
    blockNumber:   19_000_000n,
    blockTimestamp: new Date('2024-01-01T00:00:00Z'),
    toType:        'exchange',
    ...overrides,
  });
}

describe('PostgresTransferRepository', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: PostgresTransferRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });

    const schema = readFileSync(
      join(process.cwd(), 'src/infrastructure/db/schema.sql'),
      'utf-8'
    );
    await pool.query(schema);

    repository = new PostgresTransferRepository(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM transfers');
  });

  // ─── save() ───────────────────────────────────────────────

  describe('save()', () => {
    it('Transfer를 DB에 저장한다', async () => {
      // given
      const transfer = makeTransfer();

      // when
      await repository.save(transfer);

      // then
      const { rows } = await pool.query('SELECT * FROM transfers');
      expect(rows).toHaveLength(1);
      expect(rows[0].tx_hash.trim()).toBe(transfer.txHash);
      expect(rows[0].token_address.trim()).toBe(TOKEN_ADDRESS);
      expect(rows[0].to_type).toBe('exchange');
    });

    it('같은 (txHash, logIndex)로 재저장하면 중복 없이 덮어쓴다 (UPSERT)', async () => {
      // given
      await repository.save(makeTransfer({ toType: 'unknown' }));

      // when
      await repository.save(makeTransfer({ toType: 'exchange' }));

      // then
      const { rows } = await pool.query('SELECT * FROM transfers');
      expect(rows).toHaveLength(1);
      expect(rows[0].to_type).toBe('exchange');
    });
  });

  // ─── sumToExchange() ──────────────────────────────────────

  describe('sumToExchange()', () => {
    it('세력 지갑이 거래소로 보낸 누적량을 반환한다', async () => {
      // given
      await repository.save(makeTransfer({ txHash: makeTxHash('a1'), value: 1_000_000n, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('a2'), value: 2_000_000n, toType: 'exchange' }));

      // when
      const total = await repository.sumToExchange(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(total).toBe(3_000_000n);
    });

    it('거래소가 아닌 전송은 누적량에 포함하지 않는다', async () => {
      // given
      await repository.save(makeTransfer({ txHash: makeTxHash('b1'), value: 1_000_000n, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('b2'), value: 500_000n, to: NORMAL_ADDRESS, toType: 'unknown' }));

      // when
      const total = await repository.sumToExchange(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(total).toBe(1_000_000n);
    });

    it('다른 토큰의 전송은 누적량에 포함하지 않는다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await repository.save(makeTransfer({ txHash: makeTxHash('c1'), value: 1_000_000n, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('c2'), value: 999_000n, tokenAddress: OTHER_TOKEN, toType: 'exchange' }));

      // when
      const total = await repository.sumToExchange(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(total).toBe(1_000_000n);
    });

    it('저장된 데이터가 없으면 0을 반환한다', async () => {
      const total = await repository.sumToExchange(WHALE_ADDRESS, TOKEN_ADDRESS);
      expect(total).toBe(0n);
    });
  });

  // ─── sumToExchangeSince() ─────────────────────────────────

  describe('sumToExchangeSince()', () => {
    it('기준 시각 이후 전송량만 합산한다', async () => {
      // given
      const yesterday = new Date('2024-01-01T00:00:00Z');
      const today     = new Date('2024-01-02T00:00:00Z');
      const cutoff    = new Date('2024-01-02T00:00:00Z');

      await repository.save(makeTransfer({ txHash: makeTxHash('d1'), value: 1_000_000n, blockTimestamp: yesterday, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('d2'), value: 2_000_000n, blockTimestamp: today,     toType: 'exchange' }));

      // when
      const total = await repository.sumToExchangeSince(WHALE_ADDRESS, TOKEN_ADDRESS, cutoff);

      // then
      expect(total).toBe(2_000_000n);
    });
  });

  // ─── findRecentAlerts() ───────────────────────────────────

  describe('findRecentAlerts()', () => {
    it('알림 대상 전송을 최신순으로 반환한다', async () => {
      // given
      const t1 = new Date('2024-01-01T00:00:00Z');
      const t2 = new Date('2024-01-02T00:00:00Z');

      await repository.save(makeTransfer({ txHash: makeTxHash('e1'), blockTimestamp: t1, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('e2'), blockTimestamp: t2, toType: 'exchange' }));

      // when
      const alerts = await repository.findRecentAlerts(TOKEN_ADDRESS, 10);

      // then — 최신(t2)이 먼저
      expect(alerts).toHaveLength(2);
      expect(alerts[0].blockTimestamp.getTime()).toBeGreaterThan(alerts[1].blockTimestamp.getTime());
    });

    it('limit 개수만큼만 반환한다', async () => {
      // given
      for (let i = 0; i < 5; i++) {
        await repository.save(makeTransfer({ txHash: makeTxHash(`f${i}`), logIndex: i, toType: 'exchange' }));
      }

      // when
      const alerts = await repository.findRecentAlerts(TOKEN_ADDRESS, 3);

      // then
      expect(alerts).toHaveLength(3);
    });

    it('알림 대상이 아닌 전송은 포함하지 않는다', async () => {
      // given
      await repository.save(makeTransfer({ txHash: makeTxHash('aa1'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('aa2'), to: NORMAL_ADDRESS, toType: 'unknown' }));

      // when
      const alerts = await repository.findRecentAlerts(TOKEN_ADDRESS, 10);

      // then
      expect(alerts).toHaveLength(1);
      expect(alerts[0].toType).toBe('exchange');
    });

    it('다른 토큰의 알림은 포함하지 않는다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await repository.save(makeTransfer({ txHash: makeTxHash('bb1'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('bb2'), tokenAddress: OTHER_TOKEN, toType: 'exchange' }));

      // when
      const alerts = await repository.findRecentAlerts(TOKEN_ADDRESS, 10);

      // then
      expect(alerts).toHaveLength(1);
    });
  });
});
