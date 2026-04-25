export type ToType = 'exchange' | 'unknown';

interface TransferProps {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  blockTimestamp: Date;
  toType: ToType;
}

export class Transfer {
  readonly txHash: string;
  readonly logIndex: number;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly blockNumber: bigint;
  readonly blockTimestamp: Date;
  readonly toType: ToType;

  private constructor(props: TransferProps) {
    this.txHash = props.txHash;
    this.logIndex = props.logIndex;
    this.from = props.from;
    this.to = props.to;
    this.value = props.value;
    this.blockNumber = props.blockNumber;
    this.blockTimestamp = props.blockTimestamp;
    this.toType = props.toType;
  }

  static create(props: TransferProps): Transfer {
    if (!Transfer.isValidTxHash(props.txHash)) {
      throw new Error('유효하지 않은 트랜잭션 해시입니다');
    }
    if (props.value <= 0n) {
      throw new Error('전송량은 0보다 커야 합니다');
    }
    return new Transfer(props);
  }

  get isAlertTarget(): boolean {
    return this.toType === 'exchange';
  }

  get uniqueId(): string {
    return `${this.txHash}-${this.logIndex}`;
  }

  private static isValidTxHash(txHash: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(txHash);
  }
}
