import { WhaleWallet } from '../entities/WhaleWallet.js';

export interface IWhaleWalletRepository {
  findByAddress(address: string, tokenAddress: string): Promise<WhaleWallet | null>;
}
