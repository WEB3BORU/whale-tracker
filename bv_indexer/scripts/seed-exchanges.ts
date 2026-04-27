import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const EXCHANGE_ADDRESSES = [
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', name: 'Binance Hot Wallet 1' },
  { address: '0xdFd5293D8e347dFe59E90eFd55b2956a1343963D', name: 'Binance Hot Wallet 2' },
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', name: 'Binance Cold Wallet' },
  { address: '0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b', name: 'OKX Hot Wallet 1' },
  { address: '0x98EC059Dc3aDFBdd63429454aEB0c990FBA4A128', name: 'OKX Hot Wallet 2' },
  { address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', name: 'Bybit Hot Wallet 1' },
  { address: '0x2C9b2DBdba8a9c969Ac24153f5C1c23CB0e63914', name: 'Bybit Hot Wallet 2' },
  { address: '0x1AB4973a48dc892Cd9971ECE8e01DcC7688f8F23', name: 'Bitget Hot Wallet 1' },
  { address: '0x0639556F03714A74a5fEEaF5736a4A64fF70D206', name: 'Bitget Hot Wallet 2' },
];

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

async function main() {
  console.log(`[거래소 주소 등록] 총 ${EXCHANGE_ADDRESSES.length}개`);

  for (const { address, name } of EXCHANGE_ADDRESSES) {
    await pool.query(
      `INSERT INTO exchange_addresses (address, name)
       VALUES ($1, $2)
       ON CONFLICT (address) DO NOTHING`,
      [address, name]
    );
    console.log(`  ✓ ${name} — ${address}`);
  }

  console.log('\n[완료] exchange_addresses 등록 끝');
}

main()
  .catch((err) => { console.error('[오류]', err); process.exit(1); })
  .finally(() => pool.end());
