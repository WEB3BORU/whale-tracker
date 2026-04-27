import { Transfer } from '../entities/Transfer.js';

export interface ITransferRepository {
  save(transfer: Transfer): Promise<void>;

  // 특정 세력 지갑이 거래소로 보낸 누적 전송량
  sumToExchange(whaleAddress: string): Promise<bigint>;

  // 특정 시점 이후 누적 전송량 (오늘, 최근 N시간 등)
  sumToExchangeSince(whaleAddress: string, since: Date): Promise<bigint>;

  // 최근 알림 대상 전송 목록
  findRecentAlerts(limit: number): Promise<Transfer[]>;
}
