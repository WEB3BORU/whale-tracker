import { ToType } from '../../domain/entities/Transfer.js';

const DECIMALS = 18n;
const DECIMAL_DIVISOR = 10n ** DECIMALS;

export function formatTokenAmount(raw: bigint): string {
  const whole = raw / DECIMAL_DIVISOR;
  const frac = raw % DECIMAL_DIVISOR;
  const fracStr = frac.toString().padStart(Number(DECIMALS), '0').slice(0, 4);
  return `${whole.toLocaleString()}.${fracStr}`;
}

export class TelegramNotifier {
  private readonly apiUrl: string;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly tokenSymbol: string,
  ) {
    this.apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  }

  async sendWhaleAlert(params: {
    from: string;
    to: string;
    value: bigint;
    totalToday: bigint;
    totalEver: bigint;
    blockNumber: bigint;
    txHash: string;
    toType: ToType;
  }): Promise<void> {
    const destLabel = params.toType === 'exchange' ? '🏦 거래소' : '❓ 미확인';
    const text = [
      '🚨 *세력 지갑 출금 감지*',
      '',
      `*From:* \`${params.from}\``,
      `*To:* \`${params.to}\` (${destLabel})`,
      `*전송량:* ${formatTokenAmount(params.value)} ${this.tokenSymbol}`,
      `*오늘 누적:* ${formatTokenAmount(params.totalToday)} ${this.tokenSymbol}`,
      `*전체 누적:* ${formatTokenAmount(params.totalEver)} ${this.tokenSymbol}`,
      `*Block:* ${params.blockNumber}`,
      `*Tx:* \`${params.txHash}\``,
    ].join('\n');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[TelegramNotifier] 전송 실패:', body);
    }
  }
}
