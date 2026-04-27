import { createPublicClient, http, webSocket } from 'viem';
import { mainnet } from 'viem/chains';

const apiKey = process.env.ALCHEMY_API_KEY;
if (!apiKey) throw new Error('ALCHEMY_API_KEY 환경변수가 설정되지 않았습니다');

export const httpClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`),
});

export const wsClient = createPublicClient({
  chain: mainnet,
  transport: webSocket(`wss://eth-mainnet.g.alchemy.com/v2/${apiKey}`),
});
