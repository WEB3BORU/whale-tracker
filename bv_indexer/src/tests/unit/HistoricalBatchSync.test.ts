import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoricalBatchSync } from '../../infrastructure/alchemy/HistoricalBatchSync.js';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';
import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { ISyncStateRepository, SyncState } from '../../domain/repositories/ISyncStateRepository.js';
import { Transfer } from '../../domain/entities/Transfer.js';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const TOKEN_ADDRESS    = '0x17205fab260a7a6383a81452cE6315A39370Db97';
const WHALE_ADDRESS    = '0xAAAA000000000000000000000000000000000001';
const OLD_WHALE        = '0xAAAA000000000000000000000000000000000099';
const EXCHANGE_ADDRESS = '0xBBBB000000000000000000000000000000000002';
const NORMAL_ADDRESS   = '0xCCCC000000000000000000000000000000000003';
const TX_HASH          = '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
const MORALIS_API_KEY  = 'fake-moralis-key';

// ── Fake 구현체 ───────────────────────────────────────────────────────────────

class FakeWhaleWalletRepository implements IWhaleWalletRepository {
  private wallets = new Map<string, WhaleWallet>();

  private key(addr: string, token: string) {
    return `${addr.toLowerCase()}:${token.toLowerCase()}`;
  }

  seed(address: string, tokenAddress: string) {
    this.wallets.set(this.key(address, tokenAddress), WhaleWallet.create(address, tokenAddress));
  }

  async findByAddress(address: string, tokenAddress: string) {
    return this.wallets.get(this.key(address, tokenAddress)) ?? null;
  }

  async findAllByToken(tokenAddress: string) {
    return [...this.wallets.values()].filter(
      w => w.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && w.isActive
    );
  }

  async upsert(address: string, tokenAddress: string, label: string) {
    this.wallets.set(this.key(address, tokenAddress), WhaleWallet.create(address, tokenAddress, label));
  }

  async deactivateExcept(tokenAddress: string, activeAddresses: string[]) {
    const activeSet = new Set(activeAddresses.map(a => a.toLowerCase()));
    for (const wallet of this.wallets.values()) {
      if (
        wallet.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
        !activeSet.has(wallet.address.toLowerCase())
      ) {
        wallet.deactivate();
      }
    }
  }
}

class FakeExchangeAddressRepository implements IExchangeAddressRepository {
  private addresses = new Set<string>();

  add(address: string) { this.addresses.add(address.toLowerCase()); }
  async isExchange(address: string) { return this.addresses.has(address.toLowerCase()); }
}

class FakeTransferRepository implements ITransferRepository {
  saved: Transfer[] = [];
  private lastTimestamps = new Map<string, Date>();

  setLastTimestamp(address: string, ts: Date) {
    this.lastTimestamps.set(address.toLowerCase(), ts);
  }

  async save(transfer: Transfer)      { this.saved.push(transfer); }
  async sumToExchange()               { return 0n; }
  async sumToExchangeSince()          { return 0n; }
  async findRecentAlerts()            { return []; }
  async getDailyExchangeVolume()      { return []; }
  async getTopSenders()               { return []; }
  async sumAllToExchangeSince()       { return 0n; }
  async findRecentByAddress()         { return []; }
  async getLastTransferTimestamp(address: string) {
    return this.lastTimestamps.get(address.toLowerCase()) ?? null;
  }
}

class FakeSyncStateRepository implements ISyncStateRepository {
  private state: SyncState = {
    tokenAddress:       TOKEN_ADDRESS,
    lastProcessedBlock: 0n,
    isSyncing:          false,
  };

  async getOrCreate()                          { return { ...this.state }; }
  async setSyncing(_: string, v: boolean)      { this.state.isSyncing = v; }
  async updateLastProcessedBlock(_: string, b: bigint) { this.state.lastProcessedBlock = b; }
}

// ── Moralis 응답 헬퍼 ─────────────────────────────────────────────────────────

function makeHolder(address: string, pct = 5.0) {
  return { owner_address: address, percentage_relative_to_total_supply: pct };
}

function makeMoralisTransfer(overrides: { to?: string } = {}) {
  return {
    transaction_hash: TX_HASH,
    log_index:        '0',
    from_address:     WHALE_ADDRESS,
    to_address:       overrides.to ?? NORMAL_ADDRESS,
    value:            '1000000000000000000',
    block_number:     '20000000',
    block_timestamp:  '2024-01-01T00:00:00.000Z',
  };
}

function mockFetch(holders: any[], transferMap: Record<string, any[]> = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/owners')) {
      return Promise.resolve({
        ok:   true,
        json: () => Promise.resolve({ result: holders }),
        text: () => Promise.resolve(''),
      });
    }
    const match = url.match(/\/([^/?]+)\/erc20\/transfers/);
    const addr  = match?.[1]?.toLowerCase() ?? '';
    return Promise.resolve({
      ok:   true,
      json: () => Promise.resolve({ result: transferMap[addr] ?? [], cursor: null }),
      text: () => Promise.resolve(''),
    });
  });
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('HistoricalBatchSync', () => {
  let whaleRepo: FakeWhaleWalletRepository;
  let exchangeRepo: FakeExchangeAddressRepository;
  let transferRepo: FakeTransferRepository;
  let syncStateRepo: FakeSyncStateRepository;

  beforeEach(() => {
    whaleRepo     = new FakeWhaleWalletRepository();
    exchangeRepo  = new FakeExchangeAddressRepository();
    transferRepo  = new FakeTransferRepository();
    syncStateRepo = new FakeSyncStateRepository();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  function makeBatchSync(lookbackDays = 90) {
    return new HistoricalBatchSync(
      MORALIS_API_KEY, whaleRepo, exchangeRepo, transferRepo, syncStateRepo,
      TOKEN_ADDRESS, lookbackDays,
    );
  }

  // ── 가드 조건 ─────────────────────────────────────────────

  it('is_syncing이 true이면 중복 실행을 방지한다', async () => {
    await syncStateRepo.setSyncing(TOKEN_ADDRESS, true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await makeBatchSync().run();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('모든 상위 홀더가 거래소이면 동기화를 건너뛴다', async () => {
    exchangeRepo.add(WHALE_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([makeHolder(WHALE_ADDRESS)]));

    await makeBatchSync().run();

    expect(transferRepo.saved).toHaveLength(0);
  });

  // ── 지갑 목록 갱신 ────────────────────────────────────────

  it('TOP10에서 제외된 기존 지갑은 is_active = false로 처리한다', async () => {
    whaleRepo.seed(OLD_WHALE, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [] }
    ));

    await makeBatchSync().run();

    const old = await whaleRepo.findByAddress(OLD_WHALE, TOKEN_ADDRESS);
    expect(old?.isActive).toBe(false);
  });

  it('새로 진입한 지갑은 DB에 upsert된다', async () => {
    vi.stubGlobal('fetch', mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [] }
    ));

    await makeBatchSync().run();

    const wallet = await whaleRepo.findByAddress(WHALE_ADDRESS, TOKEN_ADDRESS);
    expect(wallet).not.toBeNull();
    expect(wallet?.isActive).toBe(true);
  });

  // ── 갭 메우기 ─────────────────────────────────────────────

  it('기록이 있는 지갑은 마지막 저장 시각부터 조회한다', async () => {
    const lastTs = new Date('2026-04-01T00:00:00Z');
    transferRepo.setLastTimestamp(WHALE_ADDRESS, lastTs);

    const fetchSpy = mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [] }
    );
    vi.stubGlobal('fetch', fetchSpy);

    await makeBatchSync().run();

    const transferCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('/erc20/transfers')
    );
    expect(decodeURIComponent(transferCall[0])).toContain(lastTs.toISOString());
  });

  it('기록이 없는 지갑은 lookbackDays 전부터 조회한다', async () => {
    const fetchSpy = mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [] }
    );
    vi.stubGlobal('fetch', fetchSpy);

    await makeBatchSync(30).run();

    const transferCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('/erc20/transfers')
    );
    const fromDate  = new Date(
      decodeURIComponent(transferCall[0]).match(/from_date=([^&]+)/)?.[1] ?? ''
    );
    const diffDays  = (Date.now() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });

  // ── Transfer 저장 ─────────────────────────────────────────

  it('일반 주소로의 전송은 toType unknown으로 저장한다', async () => {
    vi.stubGlobal('fetch', mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [makeMoralisTransfer({ to: NORMAL_ADDRESS })] }
    ));

    await makeBatchSync().run();

    expect(transferRepo.saved).toHaveLength(1);
    expect(transferRepo.saved[0].toType).toBe('unknown');
  });

  it('거래소 주소로의 전송은 toType exchange로 저장한다', async () => {
    exchangeRepo.add(EXCHANGE_ADDRESS);
    vi.stubGlobal('fetch', mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [makeMoralisTransfer({ to: EXCHANGE_ADDRESS })] }
    ));

    await makeBatchSync().run();

    expect(transferRepo.saved).toHaveLength(1);
    expect(transferRepo.saved[0].toType).toBe('exchange');
  });

  // ── is_syncing 복구 ───────────────────────────────────────

  it('완료 후 is_syncing이 false로 복구된다', async () => {
    vi.stubGlobal('fetch', mockFetch(
      [makeHolder(WHALE_ADDRESS)],
      { [WHALE_ADDRESS.toLowerCase()]: [] }
    ));

    await makeBatchSync().run();

    const state = await syncStateRepo.getOrCreate();
    expect(state.isSyncing).toBe(false);
  });

  it('Moralis API 오류 시 is_syncing이 false로 복구된다', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: () => Promise.resolve({ result: [makeHolder(WHALE_ADDRESS)] }),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok:     false,
        status: 429,
        text:   () => Promise.resolve('rate limited'),
      })
    );

    await expect(makeBatchSync().run()).rejects.toThrow('Moralis API 오류');
    const state = await syncStateRepo.getOrCreate();
    expect(state.isSyncing).toBe(false);
  });
});
