import pg from 'pg';
import { ISyncStateRepository, SyncState } from '../../domain/repositories/ISyncStateRepository.js';

export class PostgresSyncStateRepository implements ISyncStateRepository {
  constructor(private readonly pool: pg.Pool) {}

  async getOrCreate(tokenAddress: string): Promise<SyncState> {
    await this.pool.query(
      `INSERT INTO sync_state (token_address)
       VALUES ($1)
       ON CONFLICT (token_address) DO NOTHING`,
      [tokenAddress]
    );

    const { rows } = await this.pool.query(
      `SELECT token_address, last_processed_block, is_syncing
       FROM sync_state
       WHERE token_address = $1`,
      [tokenAddress]
    );

    const row = rows[0];
    return {
      tokenAddress:       row.token_address.trim(),
      lastProcessedBlock: BigInt(row.last_processed_block),
      isSyncing:          row.is_syncing,
    };
  }

  async setSyncing(tokenAddress: string, isSyncing: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE sync_state
       SET is_syncing = $2, updated_at = NOW()
       WHERE token_address = $1`,
      [tokenAddress, isSyncing]
    );
  }

  async updateLastProcessedBlock(tokenAddress: string, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      `UPDATE sync_state
       SET last_processed_block = $2, updated_at = NOW()
       WHERE token_address = $1`,
      [tokenAddress, blockNumber.toString()]
    );
  }
}
