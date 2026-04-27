import pg from 'pg';
import { IExchangeAddressRepository } from '../../domain/repositories/IExchangeAddressRepository.js';

export class PostgresExchangeAddressRepository implements IExchangeAddressRepository {
  constructor(private readonly pool: pg.Pool) {}

  async isExchange(address: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM exchange_addresses WHERE address = $1',
      [address]
    );

    return result.rows.length > 0;
  }
}
