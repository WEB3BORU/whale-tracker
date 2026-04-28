import { parseAbiItem, type Address } from 'viem';
import { wsClient } from './viemClient.js';
import { DetectWhaleTransferUseCase } from '../../application/usecases/DetectWhaleTransferUseCase.js';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { Transfer } from '../../domain/entities/Transfer.js';
import { TelegramNotifier } from '../telegram/TelegramNotifier.js';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export class TransferEventListener {
  constructor(
    private readonly useCase: DetectWhaleTransferUseCase,
    private readonly transferRepo: ITransferRepository,
    private readonly notifier: TelegramNotifier,
    private readonly tokenAddress: string,
  ) {}

  start(): void {
    console.log(`[리스너 시작] 토큰: ${this.tokenAddress}`);

    wsClient.watchEvent({
      address: this.tokenAddress as Address,
      event: TRANSFER_EVENT,
      onLogs: async (logs: any[]) => {
        for (const log of logs) {
          await this.handleLog(log);
        }
      },
      onError: (error: Error) => {
        console.error('[WebSocket 에러]', error);
      },
    });
  }

  private async handleLog(log: any): Promise<void> {
    const block = await wsClient.getBlock({ blockNumber: log.blockNumber });

    const transfer = Transfer.create({
      txHash:         log.transactionHash,
      logIndex:       log.logIndex,
      tokenAddress:   this.tokenAddress,
      from:           log.args.from,
      to:             log.args.to,
      value:          log.args.value,
      blockNumber:    log.blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1000),
      toType:         'unknown',
    });

    const result = await this.useCase.execute(transfer);

    if (!result.isWhale) return;

    const transferToSave = Transfer.create({ ...transfer, toType: result.toType });
    await this.transferRepo.save(transferToSave);

    if (result.isAlert) {
      const [totalEver, totalToday] = await Promise.all([
        this.transferRepo.sumToExchange(transfer.from, this.tokenAddress),
        this.transferRepo.sumToExchangeSince(transfer.from, this.tokenAddress, this.startOfToday()),
      ]);

      await this.notifier.sendWhaleAlert({
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        totalToday,
        totalEver,
        blockNumber: transfer.blockNumber,
        txHash: transfer.txHash,
      });
    }
  }

  private startOfToday(): Date {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    return now;
  }
}
