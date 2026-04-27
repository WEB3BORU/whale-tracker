import { parseAbiItem, type Address } from 'viem';
import { wsClient } from './viemClient.js';
import { DetectWhaleTransferUseCase } from '../../application/usecases/DetectWhaleTransferUseCase.js';
import { Transfer } from '../../domain/entities/Transfer.js';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export class TransferEventListener {
  constructor(private readonly useCase: DetectWhaleTransferUseCase) {}

  start(tokenAddress: Address): void {
    console.log(`[리스너 시작] 토큰: ${tokenAddress}`);

    wsClient.watchEvent({
      address: tokenAddress,
      event: TRANSFER_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          await this.handleLog(log);
        }
      },
      onError: (error) => {
        console.error('[WebSocket 에러]', error);
      },
    });
  }

  private async handleLog(log: any): Promise<void> {
    const block = await wsClient.getBlock({ blockNumber: log.blockNumber });

    const transfer = Transfer.create({
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      from: log.args.from,
      to: log.args.to,
      value: log.args.value,
      blockNumber: log.blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1000),
      toType: 'unknown',
    });

    const result = await this.useCase.execute(transfer);

    if (result.isAlert) {
      console.log('==========================');
      console.log('[경고] 세력 지갑 → 거래소 전송 감지');
      console.log(`  from     : ${transfer.from}`);
      console.log(`  to       : ${transfer.to}`);
      console.log(`  value    : ${transfer.value}`);
      console.log(`  block    : ${transfer.blockNumber}`);
      console.log(`  tx       : ${transfer.txHash}`);
      console.log('==========================');
    }
  }
}
