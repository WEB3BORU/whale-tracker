import 'dotenv/config';
import pg from 'pg';
import { type Address } from 'viem';
import { PostgresWhaleWalletRepository } from './infrastructure/db/PostgresWhaleWalletRepository.js';
import { PostgresExchangeAddressRepository } from './infrastructure/db/PostgresExchangeAddressRepository.js';
import { DetectWhaleTransferUseCase } from './application/usecases/DetectWhaleTransferUseCase.js';
import { TransferEventListener } from './infrastructure/alchemy/TransferEventListener.js';

const { Pool } = pg;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`환경변수 ${key}가 설정되지 않았습니다`);
  return value;
}

const pool = new Pool({
  host: requireEnv('DB_HOST'),
  port: Number(requireEnv('DB_PORT')),
  database: requireEnv('DB_NAME'),
  user: requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
});

const whaleWalletRepo = new PostgresWhaleWalletRepository(pool);
const exchangeAddressRepo = new PostgresExchangeAddressRepository(pool);
const useCase = new DetectWhaleTransferUseCase(whaleWalletRepo, exchangeAddressRepo);
const listener = new TransferEventListener(useCase);

const tokenAddress = requireEnv('TOKEN_ADDRESS') as Address;
listener.start(tokenAddress);
