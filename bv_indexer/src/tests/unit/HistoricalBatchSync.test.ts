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
const EXCHANGE_ADDRESS = '0xBBBB000000000000000000000000000000000002';
const NORMAL_ADDRESS   = '0xCCCC000000000000000000000000000000000003';
const TX_HASH          = '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
const MORALIS_API_KEY  = 'fake-moralis-key';

// ── Fake 구현체 ───────────────────────────────────────────────────────────────

class FakeWhaleWalletRepository implements IWhaleWalletRepository {
  private wallets: WhaleWallet[] = [];

  add(address: string, tokenAddress: string) {
    this.wallets.push(WhaleWallet.create(address, tokenAddress));
  }

  async findByAddress(address: string, tokenAddress: string) {
    return this.wallets.find(w => w.address === address && w.tokenAddress === tokenAddress) ?? null;
  }

  async findAllByToken(tokenAddress: string) {
    return this.wallets.filter(w => w.tokenAddress === tokenAddress);
  }
}

class FakeExchangeAddressRepository implements IExchangeAddressRepository {
  private addresses = new Set<string>();

  add(address: string) { this.addresses.add(address); }

  async isExchange(address: string) { return this.addresses.has(address); }
}

class FakeTransferRepository implements ITransferRepository {
  saved: Transfer[] = [];

  async save(transfer: Transfer) { this.saved.push(transfer); }
  async sumToExchange() { return 0n; }
  async sumToExchangeSince() { return 0n; }
  async findRecentAlerts() { return []; }
}

class FakeSyncStateRepository implements ISyncStateRepository {
  private state: SyncState = {
    tokenAddress:       TOKEN_ADDRESS,
    lastProcessedBlock: 0n,
    batchSyncedBlock:   null,
    isSyncing:          false,
  };

  async getOrCreate() { return { ...this.state }; }

  async setSyncing(_: string, isSyncing: boolean) {
    this.state.isSyncing = isSyncing;
  }

  async updateBatchSyncedBlock(_: string, blockNumber: bigint) {
    this.state.batchSyncedBlock = blockNumber;
  }

  async updateLastProcessedBlock(_: string, blockNumber: bigint) {
    this.state.lastProcessedBlock = blockNumber;
  }
}

// ── Moralis 응답 헬퍼 ─────────────────────────────────────────────────────────

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

function mockFetch(pages: { result: any[]; cursor: string | null }[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const page = pages[call] ?? { result: [], cursor: null };
    call++;
    return Promise.resolve({
      ok:   true,
      json: () => Promise.resolve(page),
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeBatchSync(lookbackDays = 0) {
    return new HistoricalBatchSync(
      MORALIS_API_KEY,
      whaleRepo,
      exchangeRepo,
      transferRepo,
      syncStateRepo,
      TOKEN_ADDRESS,
      lookbackDays,
    );
  }

  it('세력 지갑이 없으면 fetch를 호출하지 않는다', async () => {
    // given — 세력 지갑 미등록
    const fetchMock = mockFetch([{ result: [], cursor: null }]);
    vi.stubGlobal('fetch', fetchMock);

    // when
    await makeBatchSync().run();

    // then
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is_syncing이 true이면 중복 실행을 방지한다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    await syncStateRepo.setSyncing(TOKEN_ADDRESS, true);
    const fetchMock = mockFetch([{ result: [], cursor: null }]);
    vi.stubGlobal('fetch', fetchMock);

    // when
    await makeBatchSync().run();

    // then
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('결과가 없으면 Transfer를 저장하지 않는다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([{ result: [], cursor: null }]));

    // when
    await makeBatchSync().run();

    // then
    expect(transferRepo.saved).toHaveLength(0);
  });

  it('일반 주소로의 전송은 toType unknown으로 저장한다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([{ result: [makeMoralisTransfer({ to: NORMAL_ADDRESS })], cursor: null }]));

    // when
    await makeBatchSync().run();

    // then
    expect(transferRepo.saved).toHaveLength(1);
    expect(transferRepo.saved[0].toType).toBe('unknown');
  });

  it('거래소 주소로의 전송은 toType exchange로 저장한다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    exchangeRepo.add(EXCHANGE_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([{ result: [makeMoralisTransfer({ to: EXCHANGE_ADDRESS })], cursor: null }]));

    // when
    await makeBatchSync().run();

    // then
    expect(transferRepo.saved).toHaveLength(1);
    expect(transferRepo.saved[0].toType).toBe('exchange');
  });

  it('cursor가 반환되면 다음 페이지를 이어서 조회하고 모든 건을 저장한다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([
      { result: [makeMoralisTransfer()],               cursor: 'next-cursor' },
      { result: [makeMoralisTransfer({ to: WHALE_ADDRESS })], cursor: null    },
    ]));

    // when
    await makeBatchSync().run();

    // then — 2페이지 × 1건 = 2건 저장
    expect(transferRepo.saved).toHaveLength(2);
  });

  it('완료 후 is_syncing이 false로 복구된다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', mockFetch([{ result: [], cursor: null }]));

    // when
    await makeBatchSync().run();

    // then
    const state = await syncStateRepo.getOrCreate();
    expect(state.isSyncing).toBe(false);
  });

  it('Moralis API 오류 시 is_syncing이 false로 복구된다', async () => {
    // given
    whaleRepo.add(WHALE_ADDRESS, TOKEN_ADDRESS);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('rate limited') }));

    // when / then
    await expect(makeBatchSync().run()).rejects.toThrow('Moralis API 오류');
    const state = await syncStateRepo.getOrCreate();
    expect(state.isSyncing).toBe(false);
  });
});
