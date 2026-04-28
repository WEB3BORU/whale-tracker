import { Transfer } from '../entities/Transfer.js';

export interface DailyVolume {
  date: string;   // 'YYYY-MM-DD'
  total: bigint;
}

export interface TopSender {
  address: string;
  total: bigint;
}

export interface ITransferRepository {
  save(transfer: Transfer): Promise<void>;

  sumToExchange(whaleAddress: string, tokenAddress: string): Promise<bigint>;
  sumToExchangeSince(whaleAddress: string, tokenAddress: string, since: Date): Promise<bigint>;
  findRecentAlerts(tokenAddress: string, limit: number): Promise<Transfer[]>;

  // Telegram 조회 명령어용
  getDailyExchangeVolume(tokenAddress: string, days: number): Promise<DailyVolume[]>;
  getTopSenders(tokenAddress: string, since: Date, limit: number): Promise<TopSender[]>;
  sumAllToExchangeSince(tokenAddress: string, since: Date): Promise<bigint>;
  findRecentByAddress(address: string, tokenAddress: string, limit: number): Promise<Transfer[]>;
  getLastTransferTimestamp(address: string, tokenAddress: string): Promise<Date | null>;
}
