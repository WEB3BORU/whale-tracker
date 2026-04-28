import pg from 'pg';
import { ITransferRepository, DailyVolume, TopSender } from '../../domain/repositories/ITransferRepository.js';
import { Transfer, ToType } from '../../domain/entities/Transfer.js';

export class PostgresTransferRepository implements ITransferRepository {
  constructor(private readonly pool: pg.Pool) {}

  async save(transfer: Transfer): Promise<void> {
    await this.pool.query(
      `INSERT INTO transfers
         (tx_hash, log_index, token_address, from_address, to_address, value, block_number, block_timestamp, to_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tx_hash, log_index) DO UPDATE
         SET to_type   = EXCLUDED.to_type,
             is_orphan = EXCLUDED.is_orphan`,
      [
        transfer.txHash,
        transfer.logIndex,
        transfer.tokenAddress,
        transfer.from,
        transfer.to,
        transfer.value.toString(),
        transfer.blockNumber.toString(),
        transfer.blockTimestamp,
        transfer.toType,
      ]
    );
  }

  async sumToExchange(whaleAddress: string, tokenAddress: string): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND to_type = 'exchange'
         AND is_orphan = FALSE`,
      [whaleAddress, tokenAddress]
    );
    return BigInt(rows[0].total);
  }

  async sumToExchangeSince(whaleAddress: string, tokenAddress: string, since: Date): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND to_type = 'exchange'
         AND block_timestamp >= $3
         AND is_orphan = FALSE`,
      [whaleAddress, tokenAddress, since]
    );
    return BigInt(rows[0].total);
  }

  async findRecentAlerts(tokenAddress: string, limit: number): Promise<Transfer[]> {
    const { rows } = await this.pool.query(
      `SELECT tx_hash, log_index, token_address, from_address, to_address, value,
              block_number, block_timestamp, to_type
       FROM transfers
       WHERE token_address = $1
         AND is_orphan = FALSE
       ORDER BY block_timestamp DESC
       LIMIT $2`,
      [tokenAddress, limit]
    );
    return rows.map((row) => this.rowToTransfer(row));
  }

  async getDailyExchangeVolume(tokenAddress: string, days: number): Promise<DailyVolume[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { rows } = await this.pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('day', block_timestamp), 'YYYY-MM-DD') AS date,
         SUM(value) AS total
       FROM transfers
       WHERE token_address = $1
         AND is_orphan = FALSE
         AND block_timestamp >= $2
       GROUP BY 1
       ORDER BY 1 DESC`,
      [tokenAddress, since]
    );
    return rows.map(row => ({ date: row.date as string, total: BigInt(row.total) }));
  }

  async getTopSenders(tokenAddress: string, since: Date, limit: number): Promise<TopSender[]> {
    const { rows } = await this.pool.query(
      `SELECT
         from_address AS address,
         SUM(value) AS total
       FROM transfers
       WHERE token_address = $1
         AND is_orphan = FALSE
         AND block_timestamp >= $2
       GROUP BY from_address
       ORDER BY total DESC
       LIMIT $3`,
      [tokenAddress, since, limit]
    );
    return rows.map(row => ({ address: row.address.trim() as string, total: BigInt(row.total) }));
  }

  async sumAllToExchangeSince(tokenAddress: string, since: Date): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE token_address = $1
         AND is_orphan = FALSE
         AND block_timestamp >= $2`,
      [tokenAddress, since]
    );
    return BigInt(rows[0].total);
  }

  async findRecentByAddress(address: string, tokenAddress: string, limit: number): Promise<Transfer[]> {
    const { rows } = await this.pool.query(
      `SELECT tx_hash, log_index, token_address, from_address, to_address, value,
              block_number, block_timestamp, to_type
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND is_orphan = FALSE
       ORDER BY block_timestamp DESC
       LIMIT $3`,
      [address, tokenAddress, limit]
    );
    return rows.map(row => this.rowToTransfer(row));
  }

  async sumAllFrom(whaleAddress: string, tokenAddress: string): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND is_orphan = FALSE`,
      [whaleAddress, tokenAddress]
    );
    return BigInt(rows[0].total);
  }

  async sumAllFromSince(whaleAddress: string, tokenAddress: string, since: Date): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND block_timestamp >= $3
         AND is_orphan = FALSE`,
      [whaleAddress, tokenAddress, since]
    );
    return BigInt(rows[0].total);
  }

  async getLastTransferTimestamp(address: string, tokenAddress: string): Promise<Date | null> {
    const { rows } = await this.pool.query(
      `SELECT MAX(block_timestamp) AS last_ts
       FROM transfers
       WHERE from_address = $1
         AND token_address = $2
         AND is_orphan = FALSE`,
      [address, tokenAddress]
    );
    return rows[0].last_ts ? new Date(rows[0].last_ts) : null;
  }

  private rowToTransfer(row: any): Transfer {
    return Transfer.create({
      txHash:         row.tx_hash.trim(),
      logIndex:       row.log_index,
      tokenAddress:   row.token_address.trim(),
      from:           row.from_address.trim(),
      to:             row.to_address.trim(),
      value:          BigInt(row.value),
      blockNumber:    BigInt(row.block_number),
      blockTimestamp: new Date(row.block_timestamp),
      toType:         row.to_type as ToType,
    });
  }
}
