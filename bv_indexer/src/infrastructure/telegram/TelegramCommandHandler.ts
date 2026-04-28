import { ITransferRepository } from '../../domain/repositories/ITransferRepository.js';
import { formatTokenAmount } from './TelegramNotifier.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

export class TelegramCommandHandler {
  constructor(
    private readonly botToken: string,
    private readonly transferRepo: ITransferRepository,
    private readonly tokenAddress: string,
  ) {}

  // 무한 폴링 루프 — fire-and-forget으로 호출
  async start(): Promise<void> {
    let offset = 0;
    while (true) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${offset}&timeout=30`
        );
        if (!res.ok) throw new Error(`getUpdates 오류: ${res.status}`);

        const { result } = await res.json() as { result: TelegramUpdate[] };

        for (const update of result) {
          offset = update.update_id + 1;
          const chatId = update.message?.chat.id;
          const text   = update.message?.text;
          if (chatId && text) {
            await this.handleText(chatId, text).catch(err =>
              console.error('[TG 명령어 오류]', err)
            );
          }
        }
      } catch (err) {
        console.error('[TG 폴링 오류]', err);
        await new Promise(r => setTimeout(r, 5_000));
      }
    }
  }

  async handleText(chatId: number, text: string): Promise<void> {
    const cmd = text.trim().split(/\s+/)[0].split('@')[0];

    if (cmd === '/list')   return this.handleList(chatId);
    if (cmd === '/top')    return this.handleTop(chatId, text);
    if (cmd === '/whale')  return this.handleWhale(chatId, text);
    if (cmd === '/today')  return this.handleToday(chatId);
    if (cmd === '/recent') return this.handleRecent(chatId);
  }

  // ── 명령어 핸들러 ──────────────────────────────────────────

  private async handleList(chatId: number): Promise<void> {
    const data   = await this.transferRepo.getDailyExchangeVolume(this.tokenAddress, 7);
    const byDate = new Map(data.map(d => [d.date, d.total]));

    const lines = ['📊 *최근 7일 거래소 전송량*', '────────────────────'];
    for (let i = 0; i < 7; i++) {
      const d    = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const date = d.toISOString().slice(0, 10);
      lines.push(`${date}  ${formatTokenAmount(byDate.get(date) ?? 0n)} RAVE`);
    }

    await this.send(chatId, lines.join('\n'));
  }

  private async handleTop(chatId: number, text: string): Promise<void> {
    const parts   = text.trim().split(/\s+/);
    const days    = parts[1] ? Math.max(1, Number(parts[1])) : 30;
    const since   = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const senders = await this.transferRepo.getTopSenders(this.tokenAddress, since, 5);

    const lines = [`🏆 *최근 ${days}일 TOP ${senders.length} 매도자*`, '────────────────────'];
    if (senders.length === 0) {
      lines.push('데이터 없음');
    } else {
      senders.forEach((s, i) =>
        lines.push(`${i + 1}. \`${abbr(s.address)}\`  ${formatTokenAmount(s.total)} RAVE`)
      );
    }

    await this.send(chatId, lines.join('\n'));
  }

  private async handleWhale(chatId: number, text: string): Promise<void> {
    const address = text.trim().split(/\s+/)[1];
    if (!address) {
      await this.send(chatId, '사용법: `/whale 0x지갑주소`');
      return;
    }

    const [total, recent] = await Promise.all([
      this.transferRepo.sumToExchange(address, this.tokenAddress),
      this.transferRepo.findRecentByAddress(address, this.tokenAddress, 5),
    ]);

    const lines = [
      `🐋 *${abbr(address)}*`,
      '────────────────────',
      `전체 누적: ${formatTokenAmount(total)} RAVE`,
      '',
    ];

    if (recent.length > 0) {
      lines.push('최근 전송 (최대 5건):');
      recent.forEach(t => {
        const d = t.blockTimestamp.toISOString().slice(0, 10);
        lines.push(`• ${d}  ${formatTokenAmount(t.value)} RAVE`);
      });
    } else {
      lines.push('최근 거래소 전송 없음');
    }

    await this.send(chatId, lines.join('\n'));
  }

  private async handleToday(chatId: number): Promise<void> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const total = await this.transferRepo.sumAllToExchangeSince(this.tokenAddress, since);
    const today = new Date().toISOString().slice(0, 10);

    await this.send(chatId, [
      `📅 *오늘(${today}) 거래소 전송량*`,
      '────────────────────',
      `총 ${formatTokenAmount(total)} RAVE`,
    ].join('\n'));
  }

  private async handleRecent(chatId: number): Promise<void> {
    const alerts = await this.transferRepo.findRecentAlerts(this.tokenAddress, 10);
    const lines  = ['🔔 *최근 감지 10건*', '────────────────────'];

    if (alerts.length === 0) {
      lines.push('데이터 없음');
    } else {
      alerts.forEach((t, i) => {
        const d = t.blockTimestamp.toISOString().slice(0, 10);
        lines.push(`${i + 1}. \`${abbr(t.from)}\`  ${formatTokenAmount(t.value)} RAVE  ${d}`);
      });
    }

    await this.send(chatId, lines.join('\n'));
  }

  // ── 내부 유틸 ──────────────────────────────────────────────

  private async send(chatId: number, text: string): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[TG 전송 오류]', body);
    }
  }
}

function abbr(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}
