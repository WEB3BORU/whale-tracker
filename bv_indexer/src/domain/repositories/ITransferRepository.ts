import { Transfer } from '../entities/Transfer.js';

export interface ITransferRepository {
  save(transfer: Transfer): Promise<void>;

  sumToExchange(whaleAddress: string, tokenAddress: string): Promise<bigint>;

  sumToExchangeSince(whaleAddress: string, tokenAddress: string, since: Date): Promise<bigint>;

  findRecentAlerts(tokenAddress: string, limit: number): Promise<Transfer[]>;
}
