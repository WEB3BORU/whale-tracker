import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// ─── CLI 인수 파싱 ─────────────────────────────────────────
function parseArgs(): { tokenAddress: string; limit: number } {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf('--token');
  const limitIdx = args.indexOf('--limit');

  if (tokenIdx === -1 || !args[tokenIdx + 1]) {
    console.error('사용법: npm run seed:whales -- --token <토큰주소> [--limit <개수>]');
    console.error('예시:   npm run seed:whales -- --token 0x17205fab260a7a6383a81452cE6315A39370Db97');
    process.exit(1);
  }

  return {
    tokenAddress: args[tokenIdx + 1],
    limit: limitIdx !== -1 ? Number(args[limitIdx + 1]) : 20,
  };
}

// ─── Moralis API ───────────────────────────────────────────
interface MoralisHolder {
  owner_address: string;
  percentage_relative_to_total_supply: number;
  balance_formatted: string;
}

async function fetchTopHolders(tokenAddress: string, limit: number, apiKey: string): Promise<MoralisHolder[]> {
  const url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/owners?chain=eth&limit=${limit}&order=DESC`;

  const res = await fetch(url, {
    headers: { 'X-API-Key': apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Moralis API 오류 (${res.status}): ${body}`);
  }

  const data = await res.json() as { result: MoralisHolder[] };
  return data.result;
}

// ─── DB ────────────────────────────────────────────────────
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`환경변수 ${key}가 설정되지 않았습니다`);
  return value;
}

const pool = new Pool({
  host:     requireEnv('DB_HOST'),
  port:     Number(requireEnv('DB_PORT')),
  database: requireEnv('DB_NAME'),
  user:     requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
});

async function fetchExchangeAddresses(): Promise<Set<string>> {
  const { rows } = await pool.query<{ address: string }>('SELECT address FROM exchange_addresses');
  return new Set(rows.map((r) => r.address.trim().toLowerCase()));
}

async function upsertWhaleWallet(address: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO whale_wallets (address, label)
     VALUES ($1, $2)
     ON CONFLICT (address) DO UPDATE
       SET label = EXCLUDED.label`,
    [address, label]
  );
}

// ─── 메인 ──────────────────────────────────────────────────
async function main() {
  const { tokenAddress, limit } = parseArgs();
  const moralisApiKey = requireEnv('MORALIS_API_KEY');

  console.log(`[세력 지갑 등록 시작]`);
  console.log(`  토큰   : ${tokenAddress}`);
  console.log(`  조회수 : 상위 ${limit}개\n`);

  console.log('Moralis API 조회 중...');
  const holders = await fetchTopHolders(tokenAddress, limit, moralisApiKey);
  console.log(`  → ${holders.length}개 홀더 조회 완료\n`);

  const exchangeAddresses = await fetchExchangeAddresses();
  console.log(`거래소 주소 ${exchangeAddresses.size}개 로드 완료 (필터 적용)\n`);

  let registered = 0;
  let skipped    = 0;

  for (let i = 0; i < holders.length; i++) {
    const holder = holders[i];
    const address = holder.owner_address.toLowerCase();
    const rank    = i + 1;

    if (exchangeAddresses.has(address)) {
      console.log(`  ⊘ #${rank} ${holder.owner_address} — 거래소 주소, 건너뜀`);
      skipped++;
      continue;
    }

    const pct   = holder.percentage_relative_to_total_supply.toFixed(2);
    const label = `Top ${rank} Holder (${pct}%)`;

    await upsertWhaleWallet(holder.owner_address, label);
    console.log(`  ✓ #${rank} ${holder.owner_address} — ${label}`);
    registered++;
  }

  console.log(`\n[완료] 등록 ${registered}개 / 거래소 제외 ${skipped}개`);
}

main()
  .catch((err) => { console.error('[오류]', err); process.exit(1); })
  .finally(() => pool.end());
