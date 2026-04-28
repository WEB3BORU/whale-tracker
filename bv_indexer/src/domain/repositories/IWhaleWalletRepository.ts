import { WhaleWallet } from '../entities/WhaleWallet.js';

export interface IWhaleWalletRepository {
  findByAddress(address: string, tokenAddress: string): Promise<WhaleWallet | null>;
  findAllByToken(tokenAddress: string): Promise<WhaleWallet[]>;
  upsert(address: string, tokenAddress: string, label: string): Promise<void>;
  deactivateExcept(tokenAddress: string, activeAddresses: string[]): Promise<void>;
}
