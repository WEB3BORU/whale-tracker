import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { ISyncStateRepository } from '../../domain/repositories/ISyncStateRepository.js';
import { Transfer, ToType } from '../../domain/entities/Transfer.js';

const TOP_WHALE_LIMIT = 10;

interface MoralisHolder {
  owner_address: string;
  percentage_relative_to_total_supply: number;
}

interface MoralisHoldersResponse {
  result: MoralisHolder[];
}

interface MoralisTransfer {
  transaction_hash: string;
  log_index:        string;
  from_address:     string;
  to_address:       string;
  value:            string;
  block_number:     string;
  block_timestamp:  string;
}

interface MoralisTransferResponse {
  result: MoralisTransfer[];
  cursor: string | null;
}

export class HistoricalBatchSync {
  private readonly fallbackFromDate: Date;

  constructor(
    private readonly moralisApiKey: string,
    private readonly whaleWalletRepo: IWhaleWalletRepository,
    private readonly exchangeRepo: IExchangeAddressRepository,
    private readonly transferRepo: ITransferRepository,
    private readonly syncStateRepo: ISyncStateRepository,
    private readonly tokenAddress: string,
    private readonly lookbackDays: number,
  ) {
    this.fallbackFromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  }

  async run(): Promise<void> {
    const state = await this.syncStateRepo.getOrCreate(this.tokenAddress);
    if (state.isSyncing) {
      console.log('[배치] 이미 실행 중입니다. 중복 실행을 방지합니다.');
      return;
    }

    // ① 상위 홀더 조회 + 거래소 필터링
    console.log(`[배치] 상위 ${TOP_WHALE_LIMIT}개 지갑 조회 중...`);
    const holders      = await this.fetchTopHolders();
    const activeWallets = await this.filterAndRank(holders);

    if (activeWallets.length === 0) {
      console.log('[배치] 유효한 세력 지갑이 없습니다.');
      return;
    }

    // ② DB 지갑 목록 갱신: 제외된 지갑 비활성화, 신규 지갑 upsert
    const activeAddresses = activeWallets.map(w => w.address);
    await this.whaleWalletRepo.deactivateExcept(this.tokenAddress, activeAddresses);
    for (const { address, label } of activeWallets) {
      await this.whaleWalletRepo.upsert(address, this.tokenAddress, label);
    }
    console.log(`[배치] 세력 지갑 ${activeWallets.length}개 확정\n`);

    // ③ 각 지갑별 갭 채우기
    const whales = await this.whaleWalletRepo.findAllByToken(this.tokenAddress);

    await this.syncStateRepo.setSyncing(this.tokenAddress, true);
    try {
      for (let i = 0; i < whales.length; i++) {
        const whale    = whales[i];
        const fromDate = await this.resolveFromDate(whale.address);
        process.stdout.write(`[배치] (${i + 1}/${whales.length}) ${whale.address} 조회 중...`);
        const count = await this.syncWallet(whale.address, fromDate);
        process.stdout.write(` ${count}건 저장\n`);
      }
      console.log('\n[배치] 완료');
    } finally {
      await this.syncStateRepo.setSyncing(this.tokenAddress, false);
    }
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────

  private async filterAndRank(
    holders: MoralisHolder[]
  ): Promise<Array<{ address: string; label: string }>> {
    const result: Array<{ address: string; label: string }> = [];
    for (const holder of holders) {
      if (result.length >= TOP_WHALE_LIMIT) break;
      if (await this.exchangeRepo.isExchange(holder.owner_address)) continue;
      const rank  = result.length + 1;
      const pct   = holder.percentage_relative_to_total_supply.toFixed(2);
      result.push({ address: holder.owner_address, label: `Top ${rank} Holder (${pct}%)` });
    }
    return result;
  }

  private async resolveFromDate(address: string): Promise<Date> {
    const lastTs = await this.transferRepo.getLastTransferTimestamp(address, this.tokenAddress);
    return lastTs ?? this.fallbackFromDate;
  }

  private async syncWallet(whaleAddress: string, fromDate: Date): Promise<number> {
    let cursor: string | undefined;
    let totalSaved = 0;

    do {
      const data = await this.fetchTransfers(whaleAddress, fromDate, cursor);

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

  // ── Moralis API ────────────────────────────────────────────

  async fetchTopHolders(): Promise<MoralisHolder[]> {
    // 2× limit to account for exchange filtering
    const url = `https://deep-index.moralis.io/api/v2.2/erc20/${this.tokenAddress}/owners`
      + `?chain=eth&limit=${TOP_WHALE_LIMIT * 2}&order=DESC`;

    const res = await fetch(url, { headers: { 'X-API-Key': this.moralisApiKey } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Moralis API 오류 (${res.status}): ${body}`);
    }
    return (await res.json() as MoralisHoldersResponse).result;
  }

  async fetchTransfers(address: string, fromDate: Date, cursor?: string): Promise<MoralisTransferResponse> {
    let url = `https://deep-index.moralis.io/api/v2.2/${address}/erc20/transfers`
      + `?chain=eth`
      + `&contract_addresses[0]=${this.tokenAddress}`
      + `&from_date=${encodeURIComponent(fromDate.toISOString())}`
      + `&limit=100`;

    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, { headers: { 'X-API-Key': this.moralisApiKey } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Moralis API 오류 (${res.status}): ${body}`);
    }
    return res.json() as Promise<MoralisTransferResponse>;
  }
}
