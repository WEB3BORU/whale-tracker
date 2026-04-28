import pg from 'pg';
import { IWhaleWalletRepository } from '../../domain/repositories/IWhaleWalletRepository.js';
import { WhaleWallet } from '../../domain/entities/WhaleWallet.js';

export class PostgresWhaleWalletRepository implements IWhaleWalletRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findByAddress(address: string, tokenAddress: string): Promise<WhaleWallet | null> {
    const { rows } = await this.pool.query(
      `SELECT address, token_address, label, is_active
       FROM whale_wallets
       WHERE address = $1 AND token_address = $2`,
      [address, tokenAddress]
    );

    if (rows.length === 0) return null;

    const row    = rows[0];
    const wallet = WhaleWallet.create(row.address.trim(), row.token_address.trim(), row.label ?? undefined);
    if (!row.is_active) wallet.deactivate();
    return wallet;
  }

  async findAllByToken(tokenAddress: string): Promise<WhaleWallet[]> {
    const { rows } = await this.pool.query(
      `SELECT address, token_address, label
       FROM whale_wallets
       WHERE token_address = $1 AND is_active = TRUE`,
      [tokenAddress]
    );

    return rows.map(row =>
      WhaleWallet.create(row.address.trim(), row.token_address.trim(), row.label ?? undefined)
    );
  }

  async upsert(address: string, tokenAddress: string, label: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO whale_wallets (address, token_address, label, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (address, token_address)
       DO UPDATE SET label = EXCLUDED.label, is_active = TRUE`,
      [address, tokenAddress, label]
    );
  }

  async deactivateExcept(tokenAddress: string, activeAddresses: string[]): Promise<void> {
    if (activeAddresses.length === 0) return;
    await this.pool.query(
      `UPDATE whale_wallets
       SET is_active = FALSE
       WHERE token_address = $1
         AND is_active = TRUE
         AND address != ALL($2)`,
      [tokenAddress, activeAddresses]
    );
  }
}
