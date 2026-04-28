import pg from 'pg';
import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';

export class PostgresWhaleWalletRepository implements IWhaleWalletRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findByAddress(address: string, tokenAddress: string): Promise<WhaleWallet | null> {
    const result = await this.pool.query(
      `SELECT address, token_address, label, is_active
       FROM whale_wallets
       WHERE address = $1 AND token_address = $2`,
      [address, tokenAddress]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const wallet = WhaleWallet.create(
      row.address.trim(),
      row.token_address.trim(),
      row.label ?? undefined,
    );

    if (!row.is_active) wallet.deactivate();

    return wallet;
  }
}
