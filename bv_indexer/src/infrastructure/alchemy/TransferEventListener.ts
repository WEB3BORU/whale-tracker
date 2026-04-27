import { parseAbiItem, type Address } from 'viem';
import { wsClient } from './viemClient.js';
import { DetectWhaleTransferUseCase } from '../../application/usecases/DetectWhaleTransferUseCase.js';
import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { Transfer } from '../../domain/entities/Transfer.js';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export class TransferEventListener {
  constructor(
    private readonly useCase: DetectWhaleTransferUseCase,
    private readonly transferRepo: ITransferRepository,
  ) {}

  start(tokenAddress: Address): void {
    console.log(`[리스너 시작] 토큰: ${tokenAddress}`);

    wsClient.watchEvent({
      address: tokenAddress,
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
      from:           log.args.from,
      to:             log.args.to,
      value:          log.args.value,
      blockNumber:    log.blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1000),
      toType:         'unknown',
    });

    const result = await this.useCase.execute(transfer);

    if (!result.isWhale) return;

    // 세력 지갑 전송이면 toType 반영해서 저장
    const transferToSave = Transfer.create({ ...transfer, toType: result.toType });
    await this.transferRepo.save(transferToSave);

    if (result.isAlert) {
      const [totalEver, totalToday] = await Promise.all([
        this.transferRepo.sumToExchange(transfer.from),
        this.transferRepo.sumToExchangeSince(transfer.from, this.startOfToday()),
      ]);

      console.log('==========================');
      console.log('[경고] 세력 지갑 → 거래소 전송 감지');
      console.log(`  from       : ${transfer.from}`);
      console.log(`  to         : ${transfer.to}`);
      console.log(`  value      : ${transfer.value}`);
      console.log(`  오늘 누적   : ${totalToday}`);
      console.log(`  전체 누적   : ${totalEver}`);
      console.log(`  block      : ${transfer.blockNumber}`);
      console.log(`  tx         : ${transfer.txHash}`);
      console.log('==========================');
    }
  }

  private startOfToday(): Date {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    return now;
  }
}
