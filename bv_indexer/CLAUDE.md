# bv_indexer — 프로젝트 컨텍스트

Claude Code가 이 파일을 읽고 프로젝트 배경과 설계 방향을 파악한다.

---

## 프로젝트 개요

**프로젝트명**: bv_indexer (세력 지갑 트래커)
**한 줄 정의**: 특정 토큰의 고래/세력 지갑을 등록하고, 해당 지갑의 온체인 움직임을 실시간으로 감지하는 이더리움 인덱서

**배경**:
특정 코인(예: RAVE)이 단기간 급등할 때 상위 지갑이 전체 물량의 97% 이상을 보유하는 전형적인 작전세력 패턴이 있음.
해당 지갑들의 온체인 움직임(특히 거래소로의 Transfer)을 실시간 감지해서 매도 신호 포착, 숏 포지션 진입 타이밍에 활용하는 것이 목적.

---

## 기술 스택

| 역할 | 기술 | 이유 |
|------|------|------|
| 언어 | TypeScript | Viem이 TypeScript 전용으로 설계됨. TypeScript 없이는 ABI 타입 추론 등 핵심 기능 동작 안 함 |
| 런타임 | Node.js | TypeScript → JavaScript 실행 환경 |
| 이더리움 클라이언트 | Viem | JSON-RPC 호출 추상화, ABI 디코딩, TypeScript 타입 완전 지원 |
| DB | PostgreSQL | uint256(NUMERIC 타입) 처리, 강력한 트랜잭션(Reorg 롤백), 복잡한 조회 성능 |
| ORM | 사용 안 함 — Raw SQL | 인덱서는 쓰기 성능이 핵심. 배치 INSERT 직접 제어 필요 |
| 노드 서비스 | Alchemy | 무료 플랜에서 WebSocket + Archive Node 둘 다 지원 |
| 환경 | WSL2 (Ubuntu) | Windows에서 Linux 환경 실행 |

---

## 인덱서 핵심 개념 (구현 시 반드시 지켜야 할 원칙)

### 1. 결정론 유지
- 이벤트 핸들러 내 외부 API 호출 금지
- `Date.now()` 사용 금지 → 반드시 `block.timestamp` 사용
- 같은 블록을 몇 번 처리해도 동일한 결과가 나와야 함

### 2. 멱등성 (Idempotency)
- 모든 INSERT는 UPSERT로 처리
- 이벤트 PK = `{txHash}-{logIndex}` → 재처리해도 중복 행 생기지 않음
- 누적 값 계산 시 `+=` 금지 → 매번 재계산 또는 SET으로 덮어쓰기

### 3. Reorg 처리
- 신규 블록 수신 시 `parentHash` 반드시 검증
- 불일치 시 고아 블록 감지 → 데이터 롤백
- 롤백 방식: DELETE가 아닌 `is_orphan = TRUE` 플래그 처리 (히스토리 보존)

### 4. 실패 트랜잭션
- `status = 0`인 트랜잭션은 DB에 저장하되, 이벤트(Transfer 등)는 처리하지 않음

### 5. 통신 방식
- 과거 블록 수집 (Historical Sync): HTTP JSON-RPC
- 실시간 새 블록 감지 (Live Sync): WebSocket (`eth_subscribe("newHeads")`)

---

## 전체 동작 흐름

```
Indexer
  └─ Viem (이더리움 클라이언트)
       └─ Alchemy (노드 서비스)
            └─ Ethereum Node (원본 데이터)

1. 시작 시 PostgreSQL에서 마지막 처리 블록 조회 (indexer_checkpoint)
2. Viem으로 최신 블록 번호 조회
3. 차이가 크면 Historical Sync (HTTP, 배치 처리)
4. 따라잡으면 Live Sync (WebSocket, 실시간)
5. 각 블록에서 모니터링 대상 토큰의 Transfer 이벤트 필터링
6. from 주소가 등록된 세력 지갑이면 목적지 분류
7. 거래소 주소로 향하면 알림 트리거
8. PostgreSQL에 UPSERT 저장
```

---

## DB 스키마

### Raw 테이블

```sql
CREATE TABLE blocks (
    block_number     BIGINT      PRIMARY KEY,
    block_hash       CHAR(66)    NOT NULL UNIQUE,
    parent_hash      CHAR(66)    NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL,
    miner            CHAR(42),
    gas_used         NUMERIC(20,0),
    gas_limit        NUMERIC(20,0),
    base_fee_per_gas NUMERIC(30,0),
    tx_count         INTEGER     NOT NULL DEFAULT 0,
    is_orphan        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE transactions (
    tx_hash      CHAR(66)    PRIMARY KEY,
    block_number BIGINT      NOT NULL REFERENCES blocks(block_number),
    tx_index     INTEGER     NOT NULL,
    from_address CHAR(42)    NOT NULL,
    to_address   CHAR(42),
    value        NUMERIC(30,0) NOT NULL DEFAULT 0,
    gas_used     NUMERIC(20,0),
    gas_price    NUMERIC(30,0),
    input        TEXT,
    status       SMALLINT    NOT NULL
);

CREATE TABLE logs (
    id               BIGSERIAL PRIMARY KEY,
    block_number     BIGINT   NOT NULL,
    tx_hash          CHAR(66) NOT NULL REFERENCES transactions(tx_hash),
    log_index        INTEGER  NOT NULL,
    contract_address CHAR(42) NOT NULL,
    topic0           CHAR(66),
    topic1           CHAR(66),
    topic2           CHAR(66),
    topic3           CHAR(66),
    data             TEXT,
    UNIQUE(tx_hash, log_index)
);

CREATE TABLE indexer_checkpoint (
    chain_id   INTEGER PRIMARY KEY,
    last_block BIGINT  NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 세력 지갑 트래커 전용 테이블

```sql
-- 모니터링 대상 토큰
CREATE TABLE watched_tokens (
    contract_address CHAR(42)     PRIMARY KEY,
    symbol           VARCHAR(20),
    name             VARCHAR(100),
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- 등록된 세력 지갑
CREATE TABLE whale_wallets (
    id               BIGSERIAL    PRIMARY KEY,
    address          CHAR(42)     NOT NULL,
    token_address    CHAR(42)     NOT NULL REFERENCES watched_tokens(contract_address),
    label            VARCHAR(100),                -- 예: "RAVE 세력 지갑 #1"
    hold_percentage  NUMERIC(5,2),               -- 전체 물량 중 보유 비율
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(address, token_address)
);

-- 알려진 거래소 지갑 주소
CREATE TABLE exchange_wallets (
    address          CHAR(42)     PRIMARY KEY,
    exchange_name    VARCHAR(50)  NOT NULL,      -- 예: "Binance", "Upbit"
    wallet_type      VARCHAR(20)  NOT NULL       -- "hot", "deposit", "cold"
);

-- 세력 지갑 전송 내역
CREATE TABLE whale_transfers (
    id               VARCHAR(140) PRIMARY KEY,   -- {txHash}-{logIndex}
    block_number     BIGINT       NOT NULL,
    tx_hash          CHAR(66)     NOT NULL,
    token_address    CHAR(42)     NOT NULL,
    from_address     CHAR(42)     NOT NULL,
    to_address       CHAR(42)     NOT NULL,
    value            NUMERIC(40,0) NOT NULL,
    to_type          VARCHAR(20),                -- "exchange", "wallet", "unknown"
    exchange_name    VARCHAR(50),                -- to_type = exchange일 때
    timestamp        TIMESTAMPTZ  NOT NULL,
    is_alert_sent    BOOLEAN      DEFAULT FALSE
);

-- 인덱스
CREATE INDEX idx_whale_transfers_from    ON whale_transfers(from_address);
CREATE INDEX idx_whale_transfers_token   ON whale_transfers(token_address, timestamp DESC);
CREATE INDEX idx_whale_transfers_alert   ON whale_transfers(is_alert_sent) WHERE is_alert_sent = FALSE;
```

---

## 알림 트리거 조건

| 조건 | 의미 | 신호 강도 |
|------|------|---------|
| 세력 지갑 → 거래소 입금 주소 | 매도 준비 | 🚨 강한 숏 신호 |
| 세력 지갑 → 여러 새 지갑 분산 | 물량 쪼개기 | ⚠️ 경계 |
| 세력 지갑 → 세력 지갑 (내부) | 포지션 정리 전 움직임 가능성 | ℹ️ 참고 |
| 장기 미움직임 후 첫 전송 | 무언가 시작되는 신호 | ⚠️ 경계 |

---

## 코드 구조 (목표)

```
src/
├── client/
│   └── viemClient.ts        # Viem PublicClient 초기화
├── db/
│   ├── connection.ts         # PostgreSQL 연결
│   └── queries.ts            # Raw SQL 쿼리 함수들
├── indexer/
│   ├── BlockFetcher.ts       # 블록 데이터 수집 (HTTP + WebSocket)
│   ├── EventDecoder.ts       # ABI 기반 Transfer 이벤트 디코딩
│   ├── BlockProcessor.ts     # 블록 파싱 + DB 저장 조율
│   ├── ReorgHandler.ts       # parentHash 검증 + 롤백
│   └── CheckpointManager.ts  # 마지막 처리 블록 관리
├── tracker/
│   ├── WalletClassifier.ts   # 목적지 주소 분류 (거래소/개인/unknown)
│   └── AlertEngine.ts        # 조건 충족 시 알림 발송
└── index.ts                  # 엔트리포인트
```

---

## 이번 주 과제

1. 문서 보강 (결론 안 난 항목들 채우기)
   - ORM vs Raw SQL 결론 → Raw SQL 사용으로 확정
   - 실패 트랜잭션 저장 여부 → 저장하되 이벤트 처리는 건너뜀
   - Reorg 롤백 방식 → is_orphan 플래그 방식으로 확정

2. 코드 껍데기 작성
   - 위 클래스/함수 시그니처 + 동작 정의 주석
   - 클래스/함수 단위 시퀀스 다이어그램

---

## 참고 — 주요 이더리움 개념 요약

- **Block**: 약 12초마다 생성되는 트랜잭션 묶음
- **Transaction**: 온체인 상태를 변경하는 행위. status=1(성공)/0(실패)
- **Log/Event**: 스마트 컨트랙트가 트랜잭션 실행 시 자동으로 emit하는 데이터
- **ABI**: 컨트랙트 인터페이스 정의. 이걸로 hex 데이터를 사람이 읽을 수 있는 형태로 디코딩
- **ERC-20 Transfer 이벤트**: `Transfer(address indexed from, address indexed to, uint256 value)`
- **topic0**: 이벤트 시그니처 해시. Transfer = `keccak256("Transfer(address,address,uint256)")`
- **Reorg**: 체인 재편성. 고아 블록 발생 시 인덱서 데이터 롤백 필요
- **JSON-RPC**: 이더리움 노드와 통신하는 표준 프로토콜
- **Viem**: TypeScript 전용 이더리움 클라이언트 라이브러리. ABI 타입 추론 지원
