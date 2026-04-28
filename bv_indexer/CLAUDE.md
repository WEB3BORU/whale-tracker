# bv_indexer — 프로젝트 컨텍스트

Claude Code가 이 파일을 읽고 프로젝트 배경, 설계 방향, 그리고 **작업 방식**을 파악한다.

---

## Claude 작업 방식 지침 (최우선 원칙)

이 프로젝트의 사용자는 **Web3/블록체인 개발에 처음 입문하는 개발자**다.
목표는 빠른 구현이 아니라 **이해하면서 함께 만들어가는 것**이다.

### 작업 단계 원칙

- **한 번에 하나씩**: 요청이 들어와도 여러 개를 한꺼번에 진행하지 않는다.
  - 예: "디렉토리 구조 잡아줘" → 바로 만들지 않고, 왜 이 구조인지 설명하고 같이 결정한 뒤 진행.
- **결정 전에 설명**: 설정 하나, 파일 하나, 개념 하나를 진행하기 전에 "이게 무엇인지", "왜 필요한지" 먼저 설명한다.
- **선택지 제시**: 여러 방법이 있을 경우 각각의 장단점을 설명하고 사용자가 고를 수 있게 한다.
- **확인 후 진행**: 다음 단계로 넘어가기 전에 항상 "이해되셨나요? 이 방향으로 진행할까요?" 형태로 확인한다.

### 설명 원칙

- Web3/이더리움 용어는 처음 등장할 때 반드시 쉬운 말로 풀어서 설명한다.
- 코드 한 줄을 쓸 때도 "이 줄이 하는 일"을 주석이나 설명으로 함께 제공한다.
- 에러가 발생하면 원인을 먼저 설명하고, 수정 방법을 단계별로 안내한다.
- 개념 설명 → 코드 작성 → 동작 확인 순서를 지킨다.

### AI + 테스트 코드 원칙 (김한결 발표 기반)

- **테스트 코드가 곧 기능 명세다**: 새 기능을 구현하기 전, 테스트 코드(Given/When/Then)를 먼저 작성한다. 이것이 Claude에게 전달하는 명세가 된다.
- **아키텍처 룰을 지키면 AI가 핵심 로직을 건드리지 않는다**: Clean Architecture + 테스트 코드가 함께 있으면 DB나 외부 서비스가 바뀌어도 비즈니스 로직은 보호된다.
- **Human-readable한 구조**: Claude가 코드를 수정할 때도 사람이 읽을 수 있는 구조를 유지한다.

### 금지 사항

- 사용자가 요청하지 않은 파일/폴더를 미리 만들지 않는다.
- 한 번에 여러 개념을 묶어서 구현하지 않는다.
- "일단 이렇게 하면 됩니다"식의 결론만 제시하지 않는다.
- 테스트 없이 비즈니스 로직 코드를 먼저 작성하지 않는다.

---

## 프로젝트 개요

**프로젝트명**: bv_indexer (세력 지갑 트래커)
**한 줄 정의**: 특정 토큰의 고래/세력 지갑을 등록하고, 해당 지갑의 온체인 움직임을 실시간으로 감지하는 이더리움 인덱서

**배경**:
특정 코인(예: RAVE)이 단기간 급등할 때 상위 지갑이 전체 물량의 97% 이상을 보유하는 전형적인 작전세력 패턴이 있음.
해당 지갑들의 온체인 움직임(특히 거래소로의 Transfer)을 실시간 감지해서 매도 신호 포착, 숏 포지션 진입 타이밍에 활용하는 것이 목적.

**최종 목표**:
- Alchemy(또는 Infura) 등 외부 노드 서비스에 연결해 실제로 구동되는 인덱서 완성
- 로컬 서버 또는 무료 클라우드 서버에 배포
- 세력 지갑 움직임 감지 시 알림 수신

---

## 기술 스택

| 역할 | 기술 | 이유 |
|------|------|------|
| 언어 | TypeScript | Viem이 TypeScript 전용으로 설계됨. ABI 타입 추론 등 핵심 기능 동작 |
| 런타임 | Node.js | TypeScript → JavaScript 실행 환경 |
| 이더리움 클라이언트 | Viem | JSON-RPC 호출 추상화, ABI 디코딩, TypeScript 타입 완전 지원 |
| DB | PostgreSQL | uint256(NUMERIC 타입) 처리, 강력한 트랜잭션(Reorg 롤백), 복잡한 조회 성능 |
| ORM | 사용 안 함 — Raw SQL | 인덱서는 쓰기 성능이 핵심. 배치 INSERT 직접 제어 필요 |
| 노드 서비스 | Alchemy | 무료 플랜에서 WebSocket + Archive Node 둘 다 지원 |
| 환경 | WSL2 (Ubuntu) | Windows에서 Linux 환경 실행 |
| 테스트 러너 | Vitest | TypeScript 네이티브 지원, Jest 문법 호환, 빠른 실행 |
| 통합 테스트 DB | testcontainers | Docker로 실제 PostgreSQL 컨테이너를 테스트 중에 자동 실행/종료 |

> 기술 스택도 하나씩 직접 설치하고 연결하면서 확인한다. "왜 이 기술인가"를 이해한 뒤 도입한다.

---

## 아키텍처 — Clean Architecture

테스트 가능한 코드를 만드는 핵심 구조. 의존성은 항상 **바깥 → 안쪽(Entities)** 방향으로만 흐른다.

```
[ Frameworks & Drivers ]   ← Alchemy, PostgreSQL, Viem 등 — 추상화 대상 (DIP)
        ↓
[ Interface Adapters ]     ← 요청 해석, 명령 변환 (진입점)
        ↓
[ Use Cases ]              ← 비즈니스 로직들을 조합해 가치를 만드는 영역
        ↓
[ Entities ]               ← 핵심 도메인 로직 (이 프로젝트의 중심)
```

### 이 프로젝트에서 각 레이어가 담당하는 것

| 레이어 | 담당 |
|--------|------|
| Entities | WhaleWallet, Transfer, Block 등 핵심 도메인 규칙 |
| Use Cases | "세력 지갑이 거래소로 보냈는가" 판단 로직 |
| Interface Adapters | Viem 이벤트 → 도메인 객체 변환, DB Repository 구현체 |
| Frameworks & Drivers | Alchemy WebSocket 연결, PostgreSQL 드라이버, Viem client |

### 핵심 원칙

- **DB나 Alchemy가 바뀌어도 Entities/Use Cases는 건드리지 않는다**
- **Entities는 어떤 라이브러리에도 의존하지 않는다** (순수 TypeScript만)
- **Repository는 인터페이스로 정의** → 단위 테스트 시 FakeRepository로 교체 가능

---

## 테스트 전략

### 개발 방법론: TDD + BDD 병행

- **TDD**: 테스트 먼저 작성 → 통과하는 코드 작성 → 리팩토링
- **BDD**: 사용자가 가치있게 여기는 도메인/시나리오를 먼저 정의 → 그 시나리오에 필요한 기능만 구현
- **실전**: 단위 테스트는 TDD로, 통합/E2E 테스트는 시나리오(BDD 스타일)로 작성

### 테스트 종류별 제약

#### 단위 테스트 (Unit Test)
- 오직 하나의 클래스, 오직 하나의 함수 단위
- **서버 연결 없어야 함**
- **프레임워크/라이브러리에 의존하면 안 됨**
- **DB, Network 등 I/O 발생하면 안 됨**
- DB 대신 FakeRepository(메모리), 랜덤/시간 대신 Mock 사용

#### 통합 테스트 (Integration Test)
- 단위 테스트에서 불가능한 것 허용
- Docker(testcontainers)로 실제 PostgreSQL 컨테이너 실행
- 애플리케이션 ↔ DB 연결 검증, 모듈 간 의존성 검증

#### E2E 테스트
- 내 서비스 ↔ 외부 시스템 (Alchemy, 알림 서비스 등) 연결 검증
- 외부 시스템으로 원격 연결 허용

### 필수 패턴: Given/When/Then

모든 테스트는 이 구조를 따른다.

```typescript
describe('WhaleTransfer Entity', () => {
  it('세력 지갑에서 거래소로 전송된 경우 알림 대상으로 분류된다', () => {
    // given — 테스트에 필요한 입력/환경 구성
    const from = '0xWhaleWallet';
    const to = '0xBinanceHotWallet';

    // when — 테스트할 행동 실행
    const transfer = WhaleTransfer.create(from, to, value);

    // then — 예상한 결과 검증
    expect(transfer.toType).toBe('exchange');
    expect(transfer.isAlertTarget).toBe(true);
  });
});
```

### 테스트 격리 원칙

- 각 테스트(`it`)는 서로의 상태에 영향을 주면 안 된다
- `beforeEach` 또는 `beforeAll + db.clear()`로 상태 초기화
- 언제 실행해도 결정론적 결과가 나와야 함

### FakeRepository 패턴 (단위 테스트용)

DB 없이 단위 테스트를 빠르게 실행하기 위한 메모리 구현체.

```typescript
// 인터페이스 정의
interface WhaleWalletRepository {
  findByAddress(address: string): Promise<WhaleWallet | null>;
}

// 실제 구현체 (통합 테스트/프로덕션)
class PostgresWhaleWalletRepository implements WhaleWalletRepository { ... }

// 가짜 구현체 (단위 테스트)
class FakeWhaleWalletRepository implements WhaleWalletRepository {
  private store = new Map<string, WhaleWallet>();
  async findByAddress(address: string) {
    return this.store.get(address) ?? null;
  }
}
```

---

## 인덱서 핵심 개념

> 이 원칙들은 지금 당장 외울 필요 없다. 각 단계에서 해당 개념이 필요해질 때 함께 설명한다.

### 1. 결정론 유지
- 이벤트 핸들러 내 외부 API 호출 금지
- `Date.now()` 사용 금지 → 반드시 `block.timestamp` 사용
- 같은 블록을 몇 번 처리해도 동일한 결과가 나와야 함

### 2. 멱등성 (Idempotency)
- 모든 INSERT는 UPSERT로 처리
- 이벤트 PK = `{txHash}-{logIndex}` → 재처리해도 중복 행 생기지 않음

### 3. Reorg 처리
- 신규 블록 수신 시 `parentHash` 반드시 검증
- 불일치 시 `is_orphan = TRUE` 플래그 처리 (DELETE 금지, 히스토리 보존)

### 4. 실패 트랜잭션
- `status = 0`인 트랜잭션은 DB에 저장하되, 이벤트(Transfer 등)는 처리하지 않음

### 5. 통신 방식
- 과거 블록 수집 (Historical Sync): HTTP JSON-RPC
- 실시간 새 블록 감지 (Live Sync): WebSocket (`eth_subscribe("newHeads")`)

---

## 전체 동작 흐름 (큰 그림)

```
시작 → DB에서 마지막 블록 조회 → 최신 블록과 차이 비교
  → 차이 크면 Historical Sync (HTTP 배치)
  → 따라잡으면 Live Sync (WebSocket)
  → Transfer 이벤트 필터링 → from이 세력 지갑이면 목적지 분류
  → 거래소 주소면 알림 트리거 → PostgreSQL UPSERT
```

> DB 스키마, 코드 구조, 알림 조건은 각 단계에 도달했을 때 함께 설계한다.

---

## 구현 진행 상황

### PR 머지 이력

| PR | 브랜치 | 내용 |
|----|--------|------|
| #1 | feature/init-structure | 프로젝트 초기 설정 (디렉토리 구조, tsconfig, vitest) |
| #2 | feature/domain-entities | Entities 레이어 — WhaleWallet, Transfer 도메인 객체 + 단위 테스트 |
| #3 | feature/use-cases | Use Cases 레이어 — DetectWhaleTransferUseCase + 단위 테스트 |
| #4 | feature/db-schema | DB 스키마 — whale_wallets, exchange_addresses, transfers, sync_state |
| #5 | feature/interface-adapters | Interface Adapters — PostgreSQL Repository 구현체 + 통합 테스트 |
| #6 | feature/frameworks-drivers | Frameworks & Drivers — Viem 클라이언트, TransferEventListener, index.ts 진입점 |
| #7 | feature/multi-token-schema | Telegram 알림 (TelegramNotifier), 멀티 토큰 스키마 개선 |
| #8 | feature/moralis-batch-sync | Moralis HTTP API로 과거 이력 배치 수집 (HistoricalBatchSync 초기 버전) |

> **현재 브랜치**: `develop` — #8 이후 설계 개선 작업 중 (아직 PR 없음)

---

### develop 브랜치 작업 내역 (미머지, 2026-04-28 기준)

#8 머지 이후 실제 실행 중 발견한 문제들을 수정하고, 설계를 전면 개선했다.

#### 1. Moralis API 버그 수정

**문제 1 — 잘못된 엔드포인트**: 최초 구현에서 `/erc20/{walletAddr}/transfers`를 사용했는데, 이것은 토큰 컨트랙트 기준 엔드포인트다. 지갑 기준으로 조회하려면 `/{walletAddr}/erc20/transfers`를 사용해야 한다.

**문제 2 — 파라미터 이름**: `token_addresses[0]`이 아니라 `contract_addresses[0]`이 올바른 파라미터명이다.

**문제 3 — URL 인코딩**: `URLSearchParams`를 쓰면 `[]`가 `%5B%5D`로 인코딩되어 Moralis가 파라미터를 인식 못한다. 템플릿 리터럴로 URL을 직접 조합해야 한다.

```typescript
// 잘못된 방법 (기존)
`/erc20/${address}/transfers?token_addresses[0]=...`

// 올바른 방법 (수정 후)
`/${address}/erc20/transfers?chain=eth&contract_addresses[0]=${tokenAddress}&from_date=...`
```

**문제 4 — value=0 충돌**: Moralis는 value가 0인 Transfer 이벤트도 반환한다. `Transfer.create()`는 value > 0을 강제하므로 저장 전에 `if (BigInt(item.value) === 0n) continue;`로 스킵한다.

#### 2. 시작 흐름 재설계 (seed-whales.ts 제거)

기존에는 `npm run seed:whales` 스크립트로 지갑 목록을 수동 등록했다. 이를 `npm start` 시 자동으로 처리하도록 `HistoricalBatchSync.run()` 안에 통합했다.

**새 시작 흐름 (npm start 실행 시)**:

```
① Moralis /erc20/{tokenAddress}/owners?limit=20 호출
   → 상위 홀더 최대 20개 조회 (거래소 필터링 여유분)
② 거래소 주소 필터 적용 → 비거래소 상위 10개(TOP_WHALE_LIMIT)만 확정
③ DB 지갑 목록 갱신
   - 이번 TOP10에 없는 기존 지갑 → is_active = FALSE
   - 이번 TOP10 지갑 → UPSERT (label = "Top N Holder (X.XX%)", is_active = TRUE)
④ 각 지갑별로 getLastTransferTimestamp() 조회
   - 기록 있음 → 마지막 저장 timestamp부터 Moralis 조회
   - 기록 없음 → fallbackFromDate(= 오늘 - lookbackDays)부터 조회
   - 중복 없음: UPSERT (tx_hash, log_index) PK
⑤ 배치 완료 → TelegramCommandHandler 폴링 시작 (별도 루프)
⑥ TransferEventListener 실시간 감시 시작 (Alchemy WebSocket)
```

**핵심 설계 결정**:
- `batch_synced_block` 개념 완전 제거. 블록 번호 기반이 아닌 **per-wallet timestamp 기반** 갭 채우기.
- `TOP_WHALE_LIMIT = 10` 하드코딩. 사용자가 변경하는 값이 아님.
- `is_active = FALSE` 소프트 삭제. 지갑이 TOP10에서 빠지면 DELETE하지 않고 비활성 처리.
- `BATCH_LOOKBACK_DAYS` 환경변수로 fallback 기간 조정 가능 (기본값 90일).

#### 3. 인터페이스 변경 내역

**`ISyncStateRepository`** — `batchSyncedBlock`, `updateBatchSyncedBlock` 제거:
```typescript
export interface SyncState {
  tokenAddress: string;
  lastProcessedBlock: bigint;
  isSyncing: boolean;          // batch_synced_block 필드 삭제됨
}
export interface ISyncStateRepository {
  getOrCreate(tokenAddress: string): Promise<SyncState>;
  setSyncing(tokenAddress: string, isSyncing: boolean): Promise<void>;
  updateLastProcessedBlock(tokenAddress: string, blockNumber: bigint): Promise<void>;
  // updateBatchSyncedBlock 삭제됨
}
```

**`IWhaleWalletRepository`** — `upsert`, `deactivateExcept` 추가:
```typescript
export interface IWhaleWalletRepository {
  findByAddress(address: string, tokenAddress: string): Promise<WhaleWallet | null>;
  findAllByToken(tokenAddress: string): Promise<WhaleWallet[]>;
  upsert(address: string, tokenAddress: string, label: string): Promise<void>;
  deactivateExcept(tokenAddress: string, activeAddresses: string[]): Promise<void>;
}
```

**`ITransferRepository`** — Telegram 조회용 메서드 추가:
```typescript
export interface ITransferRepository {
  save(transfer: Transfer): Promise<void>;
  sumToExchange(whaleAddress: string, tokenAddress: string): Promise<bigint>;
  sumToExchangeSince(whaleAddress: string, tokenAddress: string, since: Date): Promise<bigint>;
  findRecentAlerts(tokenAddress: string, limit: number): Promise<Transfer[]>;
  // 아래는 신규 추가
  getDailyExchangeVolume(tokenAddress: string, days: number): Promise<DailyVolume[]>;
  getTopSenders(tokenAddress: string, since: Date, limit: number): Promise<TopSender[]>;
  sumAllToExchangeSince(tokenAddress: string, since: Date): Promise<bigint>;
  findRecentByAddress(address: string, tokenAddress: string, limit: number): Promise<Transfer[]>;
  getLastTransferTimestamp(address: string, tokenAddress: string): Promise<Date | null>;
}
```

#### 4. Telegram 조회 명령어 구현

`TelegramCommandHandler` (long-polling 방식): `getUpdates?offset=N&timeout=30` 무한 루프.

| 명령어 | 설명 | 내부 호출 |
|--------|------|-----------|
| `/list` | 최근 7일 일별 거래소 전송량 | `getDailyExchangeVolume(7)` |
| `/top [N]` | 최근 N일(기본 30) 상위 5 매도자 | `getTopSenders(since, 5)` |
| `/whale 0x주소` | 특정 지갑 누적량 + 최근 5건 | `sumToExchange` + `findRecentByAddress(5)` |
| `/today` | 오늘(UTC 0시 기준) 전체 전송량 | `sumAllToExchangeSince(startOfUTCDay)` |
| `/recent` | 최근 감지 10건 목록 | `findRecentAlerts(10)` |

#### 5. DB 스키마 변경

`sync_state` 테이블에서 `batch_synced_block BIGINT` 컬럼 제거:

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  token_address         CHAR(42)    PRIMARY KEY,
  last_processed_block  BIGINT      NOT NULL DEFAULT 0,
  is_syncing            BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- batch_synced_block 컬럼 없음
```

> **주의**: DB를 재생성해야 한다. 기존 `sync_state` 테이블이 있으면 `DROP TABLE sync_state;` 후 `schema.sql` 재적용.

#### 6. 테스트 현황

| 파일 | 종류 | 테스트 수 |
|------|------|-----------|
| WhaleWallet.test.ts | unit | 7 |
| Transfer.test.ts | unit | 6 |
| DetectWhaleTransferUseCase.test.ts | unit | 3 |
| TelegramNotifier.test.ts | unit | 7 |
| TelegramCommandHandler.test.ts | unit | 11 |
| HistoricalBatchSync.test.ts | unit | 10 |
| PostgresExchangeAddressRepository.test.ts | integration | 4 |
| PostgresWhaleWalletRepository.test.ts | integration | 12 |
| PostgresTransferRepository.test.ts | integration | 29 |
| PostgresSyncStateRepository.test.ts | integration | 4 |
| **합계** | | **88 / 88 통과** |

---

### 현재 구현된 파일 구조

```
bv_indexer/
├── scripts/
│   └── seed-exchanges.ts            ← 거래소 주소 DB 등록 (npm run seed:exchanges)
│                                      seed-whales.ts는 삭제됨 (HistoricalBatchSync로 통합)
└── src/
    ├── index.ts                     ← 진입점: 레이어 조립 → batchSync.run() → TG 폴링 → WS 리스너
    ├── application/
    │   └── usecases/
    │       └── DetectWhaleTransferUseCase.ts      ← 감지 로직 (isWhale, isAlert, toType)
    ├── domain/
    │   ├── entities/
    │   │   ├── WhaleWallet.ts                     ← 세력 지갑 도메인 객체 (isActive, deactivate())
    │   │   └── Transfer.ts                        ← ERC-20 전송 이벤트 도메인 객체
    │   └── repositories/
    │       ├── IWhaleWalletRepository.ts          ← findByAddress / findAllByToken / upsert / deactivateExcept
    │       ├── IExchangeAddressRepository.ts      ← isExchange(address)
    │       ├── ITransferRepository.ts             ← save / sumTo* / find* / getLastTransferTimestamp
    │       └── ISyncStateRepository.ts            ← getOrCreate / setSyncing / updateLastProcessedBlock
    ├── infrastructure/
    │   ├── alchemy/
    │   │   ├── viemClient.ts                      ← Alchemy HTTP/WebSocket 클라이언트 (viem)
    │   │   ├── TransferEventListener.ts           ← WS 이벤트 수신 → 감지 → DB 저장 → TG 알림
    │   │   └── HistoricalBatchSync.ts             ← Moralis API로 과거 이력 배치 수집
    │   ├── db/
    │   │   ├── schema.sql
    │   │   ├── PostgresWhaleWalletRepository.ts   ← upsert / deactivateExcept 포함
    │   │   ├── PostgresExchangeAddressRepository.ts
    │   │   ├── PostgresTransferRepository.ts      ← getLastTransferTimestamp / getDailyExchangeVolume 등
    │   │   └── PostgresSyncStateRepository.ts
    │   └── telegram/
    │       ├── TelegramNotifier.ts                ← 실시간 감지 알림 (sendWhaleAlert)
    │       └── TelegramCommandHandler.ts          ← 조회 명령어 처리 (/list /top /whale /today /recent)
    └── tests/
        ├── unit/
        │   ├── WhaleWallet.test.ts
        │   ├── Transfer.test.ts
        │   ├── DetectWhaleTransferUseCase.test.ts
        │   ├── TelegramNotifier.test.ts
        │   ├── TelegramCommandHandler.test.ts
        │   └── HistoricalBatchSync.test.ts
        └── integration/
            ├── PostgresExchangeAddressRepository.test.ts
            ├── PostgresWhaleWalletRepository.test.ts
            ├── PostgresTransferRepository.test.ts
            └── PostgresSyncStateRepository.test.ts
```

---

### 다음 작업 (미완료)

#### 즉시 필요한 것

1. **DB 재생성** — `sync_state` 테이블에서 `batch_synced_block` 컬럼이 제거됐다. 기존 컨테이너 DB를 쓰고 있다면:
   ```bash
   docker exec -i whale_tracker_db psql -U whale_user -d whale_tracker -c "DROP TABLE IF EXISTS sync_state;"
   docker exec -i whale_tracker_db psql -U whale_user -d whale_tracker < bv_indexer/src/infrastructure/db/schema.sql
   ```

2. **develop 브랜치 PR** — 현재 develop 브랜치의 변경사항을 PR로 올려 main에 머지.

#### 기능적으로 남은 것

3. **Reorg 처리** — `TransferEventListener`가 현재 `parentHash` 검증을 하지 않는다. 체인 재편성 시 `is_orphan = TRUE`로 처리하는 로직 필요. (선택적, 신뢰성 향상)

4. **배포** — 로컬 WSL2에서만 실행 중. 무료 클라우드(Render, Fly.io 등)에 배포하면 24시간 모니터링 가능.

5. **Telegram 봇 명령어 자동완성 등록** — BotFather에서 `/setcommands`로 명령어 목록을 등록하면 사용자가 `/`만 입력해도 자동완성됨.

---

### 로컬 환경 실행 방법

**사전 조건**: WSL2(Ubuntu 24.04), Node.js v20+, Docker Engine 설치 필요

```bash
# Docker 데몬 시작
sudo service docker start

# PostgreSQL 컨테이너 실행
docker compose up -d

# 스키마 적용 (처음 또는 재생성 시)
docker exec -i whale_tracker_db psql -U whale_user -d whale_tracker < bv_indexer/src/infrastructure/db/schema.sql

# 거래소 주소 등록 (최초 1회)
cd bv_indexer && npm run seed:exchanges

# 패키지 설치
npm install

# 테스트 실행
npm test

# 인덱서 실행 (배치 → TG 폴링 → WS 리스너 순으로 시작됨)
npm start
```

### .env 설정 (bv_indexer/.env)

```
# Alchemy (WebSocket 실시간 감시용)
ALCHEMY_API_KEY=발급받은_키

# Moralis (과거 이력 배치 수집용)
MORALIS_API_KEY=발급받은_키

# 추적할 토큰 컨트랙트 주소
TOKEN_ADDRESS=0x17205fab260a7a6383a81452cE6315A39370Db97

# 배치 조회 기간 (기본값 90일, 선택)
BATCH_LOOKBACK_DAYS=90

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=whale_tracker
DB_USER=whale_user
DB_PASSWORD=whale_pass

# Telegram 봇
TG_BOT_KEY=봇토큰 (BotFather에서 발급)
TG_CHAT_ID=채팅방ID (개인 또는 그룹)
```

> RAVE 토큰 컨트랙트: `0x17205fab260a7a6383a81452cE6315A39370Db97` (Ethereum Mainnet)

---

### 주요 외부 API

#### Moralis API v2.2

- **상위 홀더 조회**: `GET https://deep-index.moralis.io/api/v2.2/erc20/{tokenAddress}/owners?chain=eth&limit=20&order=DESC`
- **지갑별 전송 내역**: `GET https://deep-index.moralis.io/api/v2.2/{walletAddress}/erc20/transfers?chain=eth&contract_addresses[0]={tokenAddress}&from_date={ISO}&limit=100`
- **인증**: 헤더 `X-API-Key: {MORALIS_API_KEY}`
- **페이징**: 응답에 `cursor` 필드 있으면 다음 페이지 존재. `&cursor={cursor}` 파라미터로 다음 페이지 요청.
- **주의**: URL에 `[]`를 포함한 파라미터는 반드시 템플릿 리터럴로 조합. `URLSearchParams` 사용 시 `%5B%5D`로 인코딩되어 파라미터 무시됨.

#### Telegram Bot API

- **메시지 수신 (폴링)**: `GET https://api.telegram.org/bot{token}/getUpdates?offset={N}&timeout=30`
- **메시지 전송**: `POST https://api.telegram.org/bot{token}/sendMessage` (body: `{chat_id, text, parse_mode: "Markdown"}`)
- **봇 토큰 발급**: BotFather (@BotFather) 에서 `/newbot`

#### Alchemy

- **WebSocket URL**: `wss://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_API_KEY}`
- **HTTP URL**: `https://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_API_KEY}`
- viemClient.ts에서 `createPublicClient` (HTTP)와 `createPublicClient` (WebSocket) 두 클라이언트 생성.

---

## 참고 — 주요 이더리움 개념 요약

> 모르는 용어가 나오면 언제든 물어보면 된다. 진행하면서 하나씩 직접 다뤄본다.

- **Block**: 약 12초마다 생성되는 트랜잭션 묶음
- **Transaction**: 온체인 상태를 변경하는 행위. status=1(성공)/0(실패)
- **Log/Event**: 스마트 컨트랙트가 트랜잭션 실행 시 자동으로 emit하는 데이터
- **ABI**: 컨트랙트 인터페이스 정의. hex 데이터를 사람이 읽을 수 있는 형태로 디코딩
- **ERC-20 Transfer 이벤트**: `Transfer(address indexed from, address indexed to, uint256 value)`
- **topic0**: 이벤트 시그니처 해시. Transfer = `keccak256("Transfer(address,address,uint256)")`
- **Reorg**: 체인 재편성. 고아 블록 발생 시 인덱서 데이터 롤백 필요
- **JSON-RPC**: 이더리움 노드와 통신하는 표준 프로토콜
- **Viem**: TypeScript 전용 이더리움 클라이언트 라이브러리. ABI 타입 추론 지원
