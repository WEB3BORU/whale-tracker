import { describe, it, expect, beforeEach } from 'vitest';
import { DetectWhaleTransferUseCase } from '../../application/usecases/DetectWhaleTransferUseCase.js';
import { Transfer } from '../../domain/entities/Transfer.js';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';
import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';

const WHALE_ADDRESS = '0xAAAA000000000000000000000000000000000001';
const EXCHANGE_ADDRESS = '0xBBBB000000000000000000000000000000000002';
const NORMAL_ADDRESS = '0xCCCC000000000000000000000000000000000003';

const validTxHash = '0xabcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

class FakeWhaleWalletRepository implements IWhaleWalletRepository {
  private wallets: WhaleWallet[] = [];

  add(wallet: WhaleWallet) {
    this.wallets.push(wallet);
  }

  async findByAddress(address: string): Promise<WhaleWallet | null> {
    return this.wallets.find(w => w.address === address) ?? null;
  }
}

class FakeExchangeAddressRepository implements IExchangeAddressRepository {
  private addresses: Set<string> = new Set();

  add(address: string) {
    this.addresses.add(address);
  }

  async isExchange(address: string): Promise<boolean> {
    return this.addresses.has(address);
  }
}

describe('DetectWhaleTransferUseCase', () => {
  let whaleWalletRepo: FakeWhaleWalletRepository;
  let exchangeAddressRepo: FakeExchangeAddressRepository;
  let useCase: DetectWhaleTransferUseCase;

  beforeEach(() => {
    whaleWalletRepo = new FakeWhaleWalletRepository();
    exchangeAddressRepo = new FakeExchangeAddressRepository();
    useCase = new DetectWhaleTransferUseCase(whaleWalletRepo, exchangeAddressRepo);
  });

  it('세력 지갑에서 거래소로 전송되면 알림 대상이다', async () => {
    // given
    whaleWalletRepo.add(WhaleWallet.create(WHALE_ADDRESS));
    exchangeAddressRepo.add(EXCHANGE_ADDRESS);
    const transfer = Transfer.create({
      txHash: validTxHash,
      logIndex: 0,
      from: WHALE_ADDRESS,
      to: EXCHANGE_ADDRESS,
      value: 1000000n,
      blockNumber: 19000000n,
      blockTimestamp: new Date('2024-01-01T00:00:00Z'),
      toType: 'unknown',
    });

    // when
    const result = await useCase.execute(transfer);

    // then
    expect(result.isAlert).toBe(true);
    expect(result.toType).toBe('exchange');
  });

  it('세력 지갑에서 일반 주소로 전송되면 알림 대상이 아니다', async () => {
    // given
    whaleWalletRepo.add(WhaleWallet.create(WHALE_ADDRESS));
    const transfer = Transfer.create({
      txHash: validTxHash,
      logIndex: 0,
      from: WHALE_ADDRESS,
      to: NORMAL_ADDRESS,
      value: 1000000n,
      blockNumber: 19000000n,
      blockTimestamp: new Date('2024-01-01T00:00:00Z'),
      toType: 'unknown',
    });

    // when
    const result = await useCase.execute(transfer);

    // then
    expect(result.isAlert).toBe(false);
    expect(result.toType).toBe('unknown');
  });

  it('세력 지갑이 아닌 주소에서 전송되면 알림 대상이 아니다', async () => {
    // given
    exchangeAddressRepo.add(EXCHANGE_ADDRESS);
    const transfer = Transfer.create({
      txHash: validTxHash,
      logIndex: 0,
      from: NORMAL_ADDRESS,
      to: EXCHANGE_ADDRESS,
      value: 1000000n,
      blockNumber: 19000000n,
      blockTimestamp: new Date('2024-01-01T00:00:00Z'),
      toType: 'unknown',
    });

    // when
    const result = await useCase.execute(transfer);

    // then
    expect(result.isAlert).toBe(false);
  });
});
