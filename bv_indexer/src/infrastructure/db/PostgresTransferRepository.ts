import pg from 'pg';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { Transfer, ToType } from '../../domain/entities/Transfer.js';

export class PostgresTransferRepository implements ITransferRepository {
  constructor(private readonly pool: pg.Pool) {}

  async save(transfer: Transfer): Promise<void> {
    await this.pool.query(
      `INSERT INTO transfers
         (tx_hash, log_index, from_address, to_address, value, block_number, block_timestamp, to_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_hash, log_index) DO UPDATE
         SET to_type   = EXCLUDED.to_type,
             is_orphan = EXCLUDED.is_orphan`,
      [
        transfer.txHash,
        transfer.logIndex,
        transfer.from,
        transfer.to,
        transfer.value.toString(),
        transfer.blockNumber.toString(),
        transfer.blockTimestamp,
        transfer.toType,
      ]
    );
  }

  async sumToExchange(whaleAddress: string): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND to_type = 'exchange'
         AND is_orphan = FALSE`,
      [whaleAddress]
    );
    return BigInt(rows[0].total);
  }

  async sumToExchangeSince(whaleAddress: string, since: Date): Promise<bigint> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(value), 0) AS total
       FROM transfers
       WHERE from_address = $1
         AND to_type = 'exchange'
         AND block_timestamp >= $2
         AND is_orphan = FALSE`,
      [whaleAddress, since]
    );
    return BigInt(rows[0].total);
  }

  async findRecentAlerts(limit: number): Promise<Transfer[]> {
    const { rows } = await this.pool.query(
      `SELECT tx_hash, log_index, from_address, to_address, value,
              block_number, block_timestamp, to_type
       FROM transfers
       WHERE to_type = 'exchange'
         AND is_orphan = FALSE
       ORDER BY block_timestamp DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((row) =>
      Transfer.create({
        txHash:         row.tx_hash.trim(),
        logIndex:       row.log_index,
        from:           row.from_address.trim(),
        to:             row.to_address.trim(),
        value:          BigInt(row.value),
        blockNumber:    BigInt(row.block_number),
        blockTimestamp: new Date(row.block_timestamp),
        toType:         row.to_type as ToType,
      })
    );
  }
}
