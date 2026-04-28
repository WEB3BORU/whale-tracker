import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { ISyncStateRepository } from '../../domain/repositories/ISyncStateRepository.js';
import { Transfer, ToType } from '../../domain/entities/Transfer.js';

interface MoralisTransfer {
  transaction_hash: string;
  log_index:        string;
  from_address:     string;
  to_address:       string;
  value:            string;
  block_number:     string;
  block_timestamp:  string;
}

interface MoralisResponse {
  result: MoralisTransfer[];
  cursor: string | null;
}

export class HistoricalBatchSync {
  private readonly fromDate: Date;

  constructor(
    private readonly moralisApiKey: string,
    private readonly whaleWalletRepo: IWhaleWalletRepository,
    private readonly exchangeRepo: IExchangeAddressRepository,
    private readonly transferRepo: ITransferRepository,
    private readonly syncStateRepo: ISyncStateRepository,
    private readonly tokenAddress: string,
    private readonly lookbackDays: number,
  ) {
    this.fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  }

  async run(): Promise<void> {
    const state = await this.syncStateRepo.getOrCreate(this.tokenAddress);

    if (state.isSyncing) {
      console.log('[배치] 이미 실행 중입니다. 중복 실행을 방지합니다.');
      return;
    }

    const whales = await this.whaleWalletRepo.findAllByToken(this.tokenAddress);
    if (whales.length === 0) {
      console.log('[배치] 등록된 세력 지갑이 없습니다. seed:whales를 먼저 실행하세요.');
      return;
    }

    console.log(`[배치] 시작 — 최근 ${this.lookbackDays}일 데이터 수집 (세력 지갑 ${whales.length}개)`);
    console.log(`[배치] 기준 시각: ${this.fromDate.toISOString()}\n`);

    await this.syncStateRepo.setSyncing(this.tokenAddress, true);

    try {
      for (let i = 0; i < whales.length; i++) {
        const whale = whales[i];
        process.stdout.write(`[배치] (${i + 1}/${whales.length}) ${whale.address} 조회 중...`);
        const count = await this.syncWallet(whale.address);
        process.stdout.write(` ${count}건 저장\n`);
      }

      await this.syncStateRepo.updateBatchSyncedBlock(this.tokenAddress, BigInt(Date.now()));
      console.log('\n[배치] 완료');
    } finally {
      await this.syncStateRepo.setSyncing(this.tokenAddress, false);
    }
  }

  private async syncWallet(whaleAddress: string): Promise<number> {
    let cursor: string | undefined;
    let totalSaved = 0;

    do {
      const data = await this.fetchTransfers(whaleAddress, cursor);

      for (const item of data.result) {
        if (BigInt(item.value) === 0n) continue;

        const isExchange = await this.exchangeRepo.isExchange(item.to_address);
        const toType: ToType = isExchange ? 'exchange' : 'unknown';

        const transfer = Transfer.create({
          txHash:         item.transaction_hash,
          logIndex:       Number(item.log_index),
          tokenAddress:   this.tokenAddress,
          from:           item.from_address,
          to:             item.to_address,
          value:          BigInt(item.value),
          blockNumber:    BigInt(item.block_number),
          blockTimestamp: new Date(item.block_timestamp),
          toType,
        });

        await this.transferRepo.save(transfer);
        totalSaved++;
      }

      cursor = data.cursor ?? undefined;
    } while (cursor);

    return totalSaved;
  }

  async fetchTransfers(address: string, cursor?: string): Promise<MoralisResponse> {
    // wallet-centric endpoint: /{walletAddress}/erc20/transfers
    // URLSearchParams encodes [] as %5B%5D which some proxies reject — build manually
    const fromDate = encodeURIComponent(this.fromDate.toISOString());
    let url = `https://deep-index.moralis.io/api/v2.2/${address}/erc20/transfers`
      + `?chain=eth`
      + `&contract_addresses[0]=${this.tokenAddress}`
      + `&from_date=${fromDate}`
      + `&limit=100`;

    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, {
      headers: { 'X-API-Key': this.moralisApiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Moralis API 오류 (${res.status}): ${body}`);
    }

    return res.json() as Promise<MoralisResponse>;
  }
}
