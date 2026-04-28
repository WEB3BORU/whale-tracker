import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramNotifier, formatTokenAmount } from '../../infrastructure/telegram/TelegramNotifier.js';

const BOT_TOKEN = 'test-token';
const CHAT_ID = '123456789';

const BASE_PARAMS = {
  from:        '0xAAAA000000000000000000000000000000000001',
  to:          '0xBBBB000000000000000000000000000000000002',
  value:       1_000n * 10n ** 18n,
  totalToday:  3_000n * 10n ** 18n,
  totalEver:  10_000n * 10n ** 18n,
  blockNumber: 19000000n,
  txHash:      '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  toType:      'unknown' as const,
};

// ── formatTokenAmount ────────────────────────────────────────────────────────

describe('formatTokenAmount', () => {
  it('정수 1 RAVE를 올바르게 포맷한다', () => {
    // given
    const raw = 1n * 10n ** 18n;

    // when
    const result = formatTokenAmount(raw);

    // then
    expect(result).toBe('1.0000');
  });

  it('소수점이 있는 값을 소수 4자리까지 포맷한다', () => {
    // given
    const raw = 5n * 10n ** 17n; // 0.5 RAVE

    // when
    const result = formatTokenAmount(raw);

    // then
    expect(result).toBe('0.5000');
  });

  it('큰 정수 값을 천 단위 구분자와 함께 포맷한다', () => {
    // given
    const raw = 1_000_000n * 10n ** 18n; // 1,000,000 RAVE

    // when
    const result = formatTokenAmount(raw);

    // then
    expect(result).toBe('1,000,000.0000');
  });

  it('소수 4자리를 초과하는 값은 4자리에서 잘린다', () => {
    // given
    const raw = 1n * 10n ** 18n + 123456789n; // 1.000000000123456789 RAVE

    // when
    const result = formatTokenAmount(raw);

    // then
    expect(result).toBe('1.0000');
  });
});

// ── TelegramNotifier.sendWhaleAlert ──────────────────────────────────────────

describe('TelegramNotifier', () => {
  let notifier: TelegramNotifier;

  beforeEach(() => {
    notifier = new TelegramNotifier(BOT_TOKEN, CHAT_ID, 'RAVE');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('세력 감지 시 올바른 URL과 chat_id로 fetch를 호출한다', async () => {
    // given
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    // when
    await notifier.sendWhaleAlert(BASE_PARAMS);

    // then
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);

    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.parse_mode).toBe('Markdown');
  });

  it('메시지 본문에 from, to, value, 누적량, txHash가 포함된다', async () => {
    // given
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    // when
    await notifier.sendWhaleAlert(BASE_PARAMS);

    // then
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain(BASE_PARAMS.from);
    expect(body.text).toContain(BASE_PARAMS.to);
    expect(body.text).toContain(BASE_PARAMS.txHash);
    expect(body.text).toContain('1,000.0000');   // value
    expect(body.text).toContain('3,000.0000');   // totalToday
    expect(body.text).toContain('10,000.0000');  // totalEver
  });

  it('fetch 응답이 ok:false이면 console.error를 출력한다', async () => {
    // given
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => '{"description":"Bad Request"}',
    });
    vi.stubGlobal('fetch', mockFetch);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // when
    await notifier.sendWhaleAlert(BASE_PARAMS);

    // then
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('[TelegramNotifier]');
  });
});
