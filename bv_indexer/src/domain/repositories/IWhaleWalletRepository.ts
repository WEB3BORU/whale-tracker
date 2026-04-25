import { WhaleWallet } from '../entities/WhaleWallet.js';

export interface IWhaleWalletRepository {
  findByAddress(address: string): Promise<WhaleWallet | null>;
}
