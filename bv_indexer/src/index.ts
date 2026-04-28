import 'dotenv/config';
import pg from 'pg';
import { PostgresWhaleWalletRepository } from './infrastructure/db/PostgresWhaleWalletRepository.js';
import { PostgresExchangeAddressRepository } from './infrastructure/db/PostgresExchangeAddressRepository.js';
import { PostgresTransferRepository } from './infrastructure/db/PostgresTransferRepository.js';
import { PostgresSyncStateRepository } from './infrastructure/db/PostgresSyncStateRepository.js';
import { DetectWhaleTransferUseCase } from './application/usecases/DetectWhaleTransferUseCase.js';
import { TransferEventListener } from './infrastructure/alchemy/TransferEventListener.js';
import { HistoricalBatchSync } from './infrastructure/alchemy/HistoricalBatchSync.js';
import { TelegramNotifier } from './infrastructure/telegram/TelegramNotifier.js';

const { Pool } = pg;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`환경변수 ${key}가 설정되지 않았습니다`);
  return value;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

const pool = new Pool({
  host:     requireEnv('DB_HOST'),
  port:     Number(requireEnv('DB_PORT')),
  database: requireEnv('DB_NAME'),
  user:     requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
});

const tokenAddress = requireEnv('TOKEN_ADDRESS');
const lookbackDays = Number(optionalEnv('BATCH_LOOKBACK_DAYS') ?? '90');

const whaleWalletRepo    = new PostgresWhaleWalletRepository(pool);
const exchangeAddressRepo = new PostgresExchangeAddressRepository(pool);
const transferRepo       = new PostgresTransferRepository(pool);
const syncStateRepo      = new PostgresSyncStateRepository(pool);
const notifier           = new TelegramNotifier(requireEnv('TG_BOT_KEY'), requireEnv('TG_CHAT_ID'));
const useCase            = new DetectWhaleTransferUseCase(whaleWalletRepo, exchangeAddressRepo);
const listener           = new TransferEventListener(useCase, transferRepo, notifier, tokenAddress);

const batchSync = new HistoricalBatchSync(
  requireEnv('MORALIS_API_KEY'),
  whaleWalletRepo,
  exchangeAddressRepo,
  transferRepo,
  syncStateRepo,
  tokenAddress,
  lookbackDays,
);

async function main() {
  await batchSync.run();
  listener.start();
}

main().catch((err) => {
  console.error('[시작 오류]', err);
  process.exit(1);
});
