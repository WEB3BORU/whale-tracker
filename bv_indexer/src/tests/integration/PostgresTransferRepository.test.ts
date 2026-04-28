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

    it('exchange, unknown 모든 전송을 반환한다', async () => {
      // given
      await repository.save(makeTransfer({ txHash: makeTxHash('aa1'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('aa2'), to: NORMAL_ADDRESS, toType: 'unknown' }));

      // when
      const alerts = await repository.findRecentAlerts(TOKEN_ADDRESS, 10);

      // then
      expect(alerts).toHaveLength(2);
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

  // ─── getDailyExchangeVolume() ──────────────────────────────

  describe('getDailyExchangeVolume()', () => {
    it('최근 N일 이내 exchange 전송량을 일별로 집계해 반환한다', async () => {
      // given — 3일 전(window 내)과 10일 전(window 밖) 데이터
      const within  = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const outside = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      await repository.save(makeTransfer({ txHash: makeTxHash('ca1'), value: 1_000_000n, blockTimestamp: within,  toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('ca2'), value: 2_000_000n, blockTimestamp: within,  toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('ca3'), value: 9_000_000n, blockTimestamp: outside, toType: 'exchange' }));

      // when
      const result = await repository.getDailyExchangeVolume(TOKEN_ADDRESS, 7);

      // then — within 날짜만 집계 (1건 날짜), 합산 3_000_000n
      expect(result).toHaveLength(1);
      expect(result[0].total).toBe(3_000_000n);
    });

    it('unknown 전송도 집계에 포함한다', async () => {
      // given
      const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await repository.save(makeTransfer({ txHash: makeTxHash('cb1'), value: 1_000_000n, blockTimestamp: ts, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('cb2'), value: 9_000_000n, to: NORMAL_ADDRESS, blockTimestamp: ts, toType: 'unknown' }));

      // when
      const result = await repository.getDailyExchangeVolume(TOKEN_ADDRESS, 7);

      // then
      expect(result[0].total).toBe(10_000_000n);
    });

    it('데이터가 없으면 빈 배열을 반환한다', async () => {
      const result = await repository.getDailyExchangeVolume(TOKEN_ADDRESS, 7);
      expect(result).toHaveLength(0);
    });
  });

  // ─── getTopSenders() ──────────────────────────────────────

  describe('getTopSenders()', () => {
    const WHALE_2 = '0xAAAA000000000000000000000000000000000002';

    it('지정 기간 동안 가장 많이 보낸 지갑 순으로 반환한다', async () => {
      // given
      const since = new Date('2024-01-01T00:00:00Z');
      await repository.save(makeTransfer({ txHash: makeTxHash('da1'), from: WHALE_ADDRESS, value: 1_000_000n, blockTimestamp: new Date('2024-01-02'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('da2'), from: WHALE_2,       value: 5_000_000n, blockTimestamp: new Date('2024-01-02'), to: EXCHANGE_ADDRESS, toType: 'exchange' }));

      // when
      const result = await repository.getTopSenders(TOKEN_ADDRESS, since, 5);

      // then — WHALE_2가 더 많이 보냈으므로 먼저 나와야 함
      expect(result).toHaveLength(2);
      expect(result[0].address.toLowerCase()).toBe(WHALE_2.toLowerCase());
      expect(result[0].total).toBe(5_000_000n);
    });

    it('limit 개수만큼만 반환한다', async () => {
      // given
      const since = new Date('2024-01-01T00:00:00Z');
      for (let i = 0; i < 4; i++) {
        const from = `0xAAAA00000000000000000000000000000000000${i}`;
        await repository.save(makeTransfer({
          txHash: makeTxHash(`db${i}`), from,
          blockTimestamp: new Date('2024-01-02'), toType: 'exchange',
        }));
      }

      // when
      const result = await repository.getTopSenders(TOKEN_ADDRESS, since, 2);

      // then
      expect(result).toHaveLength(2);
    });

    it('since 이전 데이터는 포함하지 않는다', async () => {
      // given
      const since = new Date('2024-06-01T00:00:00Z');
      await repository.save(makeTransfer({ txHash: makeTxHash('dc1'), blockTimestamp: new Date('2024-01-01'), toType: 'exchange' }));

      // when
      const result = await repository.getTopSenders(TOKEN_ADDRESS, since, 5);

      // then
      expect(result).toHaveLength(0);
    });
  });

  // ─── sumAllToExchangeSince() ──────────────────────────────

  describe('sumAllToExchangeSince()', () => {
    it('기준 시각 이후 모든 지갑의 거래소 전송량을 합산한다', async () => {
      // given
      const WHALE_2 = '0xAAAA000000000000000000000000000000000002';
      const since   = new Date('2024-01-02T00:00:00Z');

      await repository.save(makeTransfer({ txHash: makeTxHash('ea1'), from: WHALE_ADDRESS, value: 1_000_000n, blockTimestamp: new Date('2024-01-03'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('ea2'), from: WHALE_2,       value: 2_000_000n, blockTimestamp: new Date('2024-01-03'), to: EXCHANGE_ADDRESS, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('ea3'), from: WHALE_ADDRESS, value: 9_000_000n, blockTimestamp: new Date('2024-01-01'), toType: 'exchange' }));

      // when
      const total = await repository.sumAllToExchangeSince(TOKEN_ADDRESS, since);

      // then — ea1 + ea2만 합산 (ea3는 since 이전)
      expect(total).toBe(3_000_000n);
    });

    it('데이터가 없으면 0n을 반환한다', async () => {
      const total = await repository.sumAllToExchangeSince(TOKEN_ADDRESS, new Date());
      expect(total).toBe(0n);
    });
  });

  // ─── findRecentByAddress() ────────────────────────────────

  describe('findRecentByAddress()', () => {
    it('특정 지갑의 exchange 전송을 최신순으로 반환한다', async () => {
      // given
      const t1 = new Date('2024-01-01T00:00:00Z');
      const t2 = new Date('2024-01-02T00:00:00Z');
      await repository.save(makeTransfer({ txHash: makeTxHash('fa1'), blockTimestamp: t1, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('fa2'), blockTimestamp: t2, toType: 'exchange' }));

      // when
      const result = await repository.findRecentByAddress(WHALE_ADDRESS, TOKEN_ADDRESS, 10);

      // then — 최신(t2)이 먼저
      expect(result).toHaveLength(2);
      expect(result[0].blockTimestamp.getTime()).toBeGreaterThan(result[1].blockTimestamp.getTime());
    });

    it('다른 지갑의 전송은 반환하지 않는다', async () => {
      // given
      const OTHER_WHALE = '0xAAAA000000000000000000000000000000000002';
      await repository.save(makeTransfer({ txHash: makeTxHash('fb1'), from: WHALE_ADDRESS, toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('fb2'), from: OTHER_WHALE,   toType: 'exchange' }));

      // when
      const result = await repository.findRecentByAddress(WHALE_ADDRESS, TOKEN_ADDRESS, 10);

      // then
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe(WHALE_ADDRESS);
    });

    it('unknown 전송도 반환한다', async () => {
      // given
      await repository.save(makeTransfer({ txHash: makeTxHash('fc1'), toType: 'exchange' }));
      await repository.save(makeTransfer({ txHash: makeTxHash('fc2'), to: NORMAL_ADDRESS, toType: 'unknown' }));

      // when
      const result = await repository.findRecentByAddress(WHALE_ADDRESS, TOKEN_ADDRESS, 10);

      // then
      expect(result).toHaveLength(2);
    });

    it('limit 개수만큼만 반환한다', async () => {
      // given
      for (let i = 0; i < 5; i++) {
        await repository.save(makeTransfer({ txHash: makeTxHash(`fd${i}`), logIndex: i, toType: 'exchange' }));
      }

      // when
      const result = await repository.findRecentByAddress(WHALE_ADDRESS, TOKEN_ADDRESS, 3);

      // then
      expect(result).toHaveLength(3);
    });
  });

  // ─── getLastTransferTimestamp() ───────────────────────────

  describe('getLastTransferTimestamp()', () => {
    it('저장된 전송 중 가장 최신 block_timestamp를 반환한다', async () => {
      // given
      const t1 = new Date('2024-01-01T00:00:00Z');
      const t2 = new Date('2024-01-03T00:00:00Z');
      await repository.save(makeTransfer({ txHash: makeTxHash('aa01'), blockTimestamp: t1 }));
      await repository.save(makeTransfer({ txHash: makeTxHash('aa02'), blockTimestamp: t2 }));

      // when
      const result = await repository.getLastTransferTimestamp(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(t2.getTime());
    });

    it('해당 주소의 전송이 없으면 null을 반환한다', async () => {
      // when
      const result = await repository.getLastTransferTimestamp(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).toBeNull();
    });

    it('다른 토큰의 전송은 포함하지 않는다', async () => {
      // given
      const OTHER_TOKEN = '0xDDDD000000000000000000000000000000000004';
      await repository.save(makeTransfer({
        txHash: makeTxHash('ab01'),
        tokenAddress: OTHER_TOKEN,
        blockTimestamp: new Date('2024-06-01T00:00:00Z'),
      }));

      // when
      const result = await repository.getLastTransferTimestamp(WHALE_ADDRESS, TOKEN_ADDRESS);

      // then
      expect(result).toBeNull();
    });
  });
});
