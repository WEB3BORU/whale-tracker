import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramCommandHandler } from '../../infrastructure/telegram/TelegramCommandHandler.js';
import { ITransferRepository, DailyVolume, TopSender } from '../../domain/repositories/ITransferRepository.js';
import { Transfer } from '../../domain/entities/Transfer.js';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const TOKEN_ADDRESS = '0x17205fab260a7a6383a81452cE6315A39370Db97';
const WHALE_ADDRESS = '0xAAAA000000000000000000000000000000000001';
const BOT_TOKEN     = 'fake-bot-token';
const CHAT_ID       = 12345;
const TX_HASH       = '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

// ── Fake 구현체 ───────────────────────────────────────────────────────────────

class FakeTransferRepository implements ITransferRepository {
  async save() {}
  async sumToExchange()              { return 0n; }
  async sumToExchangeSince()         { return 0n; }
  async findRecentAlerts()           { return []; }
  async getDailyExchangeVolume()     { return []; }
  async getTopSenders()              { return []; }
  async sumAllToExchangeSince()      { return 0n; }
  async findRecentByAddress()        { return []; }
  async getLastTransferTimestamp()   { return null; }
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function makeTransfer(blockTimestamp = new Date('2026-04-28T00:00:00Z')): Transfer {
  return Transfer.create({
    txHash: TX_HASH, logIndex: 0,
    tokenAddress: TOKEN_ADDRESS,
    from: WHALE_ADDRESS, to: '0xBBBB000000000000000000000000000000000002',
    value: 1_000n * 10n ** 18n, blockNumber: 20_000_000n,
    blockTimestamp, toType: 'exchange',
  });
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('TelegramCommandHandler', () => {
  let repo: FakeTransferRepository;
  let handler: TelegramCommandHandler;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repo    = new FakeTransferRepository();
    handler = new TelegramCommandHandler(BOT_TOKEN, repo, TOKEN_ADDRESS);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentText(): string {
    const [, init] = fetchMock.mock.calls[0];
    return JSON.parse(init.body).text;
  }

  // ── /list ─────────────────────────────────────────────────

  it('/list — getDailyExchangeVolume(7)을 호출하고 일별 합산을 전송한다', async () => {
    // given
    vi.spyOn(repo, 'getDailyExchangeVolume').mockResolvedValue([
      { date: new Date().toISOString().slice(0, 10), total: 1_000n * 10n ** 18n },
    ] as DailyVolume[]);

    // when
    await handler.handleText(CHAT_ID, '/list');

    // then
    expect(repo.getDailyExchangeVolume).toHaveBeenCalledWith(TOKEN_ADDRESS, 7);
    expect(sentText()).toContain('최근 7일');
    expect(sentText()).toContain('1,000.0000 RAVE');
  });

  it('/list — 데이터 없는 날은 0 RAVE로 채운다', async () => {
    // given — 빈 응답
    vi.spyOn(repo, 'getDailyExchangeVolume').mockResolvedValue([]);

    // when
    await handler.handleText(CHAT_ID, '/list');

    // then — 7줄(날짜)이 모두 포함됨
    const text = sentText();
    const dateLines = text.split('\n').filter((l: string) => /\d{4}-\d{2}-\d{2}/.test(l));
    expect(dateLines).toHaveLength(7);
    expect(text).toContain('0.0000 RAVE');
  });

  // ── /top ──────────────────────────────────────────────────

  it('/top — 기본값 30일로 getTopSenders(5)를 호출한다', async () => {
    // given
    vi.spyOn(repo, 'getTopSenders').mockResolvedValue([
      { address: WHALE_ADDRESS, total: 5_000n * 10n ** 18n },
    ] as TopSender[]);

    // when
    await handler.handleText(CHAT_ID, '/top');

    // then
    const [, since] = vi.mocked(repo.getTopSenders).mock.calls[0];
    const diffDays = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
    expect(sentText()).toContain('30일');
    expect(sentText()).toContain('5,000.0000 RAVE');
  });

  it('/top 7 — 7일로 getTopSenders를 호출한다', async () => {
    // given
    vi.spyOn(repo, 'getTopSenders').mockResolvedValue([]);

    // when
    await handler.handleText(CHAT_ID, '/top 7');

    // then
    const [, since] = vi.mocked(repo.getTopSenders).mock.calls[0];
    const diffDays = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
    expect(sentText()).toContain('7일');
  });

  it('/top — 결과 없으면 "데이터 없음" 메시지를 전송한다', async () => {
    // given
    vi.spyOn(repo, 'getTopSenders').mockResolvedValue([]);

    // when
    await handler.handleText(CHAT_ID, '/top');

    // then
    expect(sentText()).toContain('데이터 없음');
  });

  // ── /whale ────────────────────────────────────────────────

  it('/whale <주소> — sumToExchange와 findRecentByAddress를 호출한다', async () => {
    // given
    vi.spyOn(repo, 'sumToExchange').mockResolvedValue(2_000n * 10n ** 18n);
    vi.spyOn(repo, 'findRecentByAddress').mockResolvedValue([makeTransfer()]);

    // when
    await handler.handleText(CHAT_ID, `/whale ${WHALE_ADDRESS}`);

    // then
    expect(repo.sumToExchange).toHaveBeenCalledWith(WHALE_ADDRESS, TOKEN_ADDRESS);
    expect(repo.findRecentByAddress).toHaveBeenCalledWith(WHALE_ADDRESS, TOKEN_ADDRESS, 5);
    const text = sentText();
    expect(text).toContain('2,000.0000 RAVE');
    expect(text).toContain('2026-04-28');
  });

  it('/whale 주소 누락 — 사용법 안내 메시지를 전송한다', async () => {
    // when
    await handler.handleText(CHAT_ID, '/whale');

    // then
    expect(sentText()).toContain('사용법');
  });

  // ── /today ────────────────────────────────────────────────

  it('/today — 오늘 자정 기준으로 sumAllToExchangeSince를 호출한다', async () => {
    // given
    vi.spyOn(repo, 'sumAllToExchangeSince').mockResolvedValue(3_000n * 10n ** 18n);

    // when
    await handler.handleText(CHAT_ID, '/today');

    // then
    const [, since] = vi.mocked(repo.sumAllToExchangeSince).mock.calls[0];
    expect(since.getUTCHours()).toBe(0);
    expect(since.getUTCMinutes()).toBe(0);
    expect(sentText()).toContain('3,000.0000 RAVE');
  });

  // ── /recent ───────────────────────────────────────────────

  it('/recent — findRecentAlerts(10)를 호출하고 목록을 전송한다', async () => {
    // given
    vi.spyOn(repo, 'findRecentAlerts').mockResolvedValue([makeTransfer()]);

    // when
    await handler.handleText(CHAT_ID, '/recent');

    // then
    expect(repo.findRecentAlerts).toHaveBeenCalledWith(TOKEN_ADDRESS, 10);
    expect(sentText()).toContain('1,000.0000 RAVE');
  });

  it('/recent — 데이터 없으면 "데이터 없음" 메시지를 전송한다', async () => {
    // given
    vi.spyOn(repo, 'findRecentAlerts').mockResolvedValue([]);

    // when
    await handler.handleText(CHAT_ID, '/recent');

    // then
    expect(sentText()).toContain('데이터 없음');
  });

  // ── 기타 ──────────────────────────────────────────────────

  it('알 수 없는 명령어는 무시한다 (fetch 호출 없음)', async () => {
    // when
    await handler.handleText(CHAT_ID, '/unknown');

    // then
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
