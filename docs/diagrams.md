# bv_indexer 시스템 다이어그램

**프로젝트**: 세력 지갑 트래커
**목적**: 특정 ERC-20 토큰의 상위 홀더(세력 지갑) 온체인 출금을 실시간 감지하고 Telegram으로 알림

---

## 목차

1. [데이터베이스 ERD](#1-데이터베이스-erd)
2. [Clean Architecture 레이어 구조](#2-clean-architecture-레이어-구조)
3. [클래스 다이어그램](#3-클래스-다이어그램)
4. [시퀀스 — 애플리케이션 시작 흐름](#4-시퀀스--애플리케이션-시작-흐름)
5. [시퀀스 — 실시간 Transfer 감지](#5-시퀀스--실시간-transfer-감지)
6. [시퀀스 — Telegram 명령어 처리](#6-시퀀스--telegram-명령어-처리)

---

## 1. 데이터베이스 ERD

테이블 4개로 구성. **FK 제약은 없으며** 모든 관계는 애플리케이션 레벨에서 처리.

```mermaid
erDiagram
    whale_wallets {
        CHAR(42)    address        PK  "이더리움 지갑 주소"
        CHAR(42)    token_address  PK  "추적 토큰 컨트랙트"
        TEXT        label              "Top N Holder (X.XX%)"
        BOOLEAN     is_active          "TOP10 탈락 시 FALSE (소프트 삭제)"
        TIMESTAMPTZ created_at
    }

    exchange_addresses {
        CHAR(42)    address  PK  "거래소 핫월렛 주소"
        TEXT        name         "Binance Hot Wallet 1 등"
        TIMESTAMPTZ created_at
    }

    transfers {
        CHAR(66)    tx_hash         PK  "트랜잭션 해시"
        INTEGER     log_index       PK  "이벤트 인덱스 — PK=(tx_hash,log_index)"
        CHAR(42)    token_address       "토큰 컨트랙트"
        CHAR(42)    from_address        "송신자"
        CHAR(42)    to_address          "수신자"
        NUMERIC(78) value               "ERC-20 원시값 (18 decimals)"
        BIGINT      block_number
        TIMESTAMPTZ block_timestamp
        TEXT        to_type             "exchange | unknown"
        BOOLEAN     is_orphan           "Reorg 발생 시 TRUE"
    }

    sync_state {
        CHAR(42)    token_address         PK  "토큰 1개 = 1행"
        BIGINT      last_processed_block      "실시간 리스너 기준 블록"
        BOOLEAN     is_syncing                "배치 중복 실행 방지 플래그"
        TIMESTAMPTZ updated_at
    }

    whale_wallets   ||--o{ transfers      : "from_address (논리적)"
    exchange_addresses |o--o{ transfers   : "to_address, to_type=exchange 일 때"
    sync_state      ||--o{ whale_wallets  : "token_address (논리적)"
```

### 주요 설계 결정

| 결정 | 이유 |
|------|------|
| `(tx_hash, log_index)` 복합 PK | 동일 트랜잭션에 여러 Transfer 이벤트 가능. 재처리해도 중복 행 없음 (멱등성) |
| `is_orphan` 플래그 | Reorg 발생 시 행을 DELETE하지 않고 플래그만 변경 → 히스토리 보존 |
| `is_active` 소프트 삭제 | TOP10에서 빠진 지갑을 삭제하지 않음 → 과거 이력 유지 |
| `to_type` 컬럼 | 거래소 여부를 저장 시점에 판정해 두면 조회 시 JOIN 불필요 |
| FK 없음 | 인덱서 특성상 배치 INSERT 성능이 핵심. 참조 무결성은 앱 레벨에서 보장 |

---

## 2. Clean Architecture 레이어 구조

의존성은 항상 **바깥(Frameworks) → 안쪽(Domain)** 방향으로만 흐른다.
Domain 레이어는 어떤 외부 라이브러리에도 의존하지 않는다.

```mermaid
graph TD
    subgraph FW["🌐 Frameworks & Drivers (외부 시스템)"]
        ALCHEMY["Alchemy\nWebSocket · HTTP"]
        MORALIS["Moralis\nREST API"]
        POSTGRES["PostgreSQL"]
        TG_API["Telegram Bot API"]
    end

    subgraph INFRA["🔧 Infrastructure Layer (어댑터 구현체)"]
        VIEM["viemClient.ts\nhttpClient / wsClient"]
        TEL["TransferEventListener.ts"]
        HBS["HistoricalBatchSync.ts"]
        REPOS["PostgresWhaleWalletRepository\nPostgresTransferRepository\nPostgresExchangeAddressRepository\nPostgresSyncStateRepository"]
        NOTIF["TelegramNotifier.ts"]
        CMD["TelegramCommandHandler.ts"]
    end

    subgraph UC["💼 Use Cases (비즈니스 흐름 조합)"]
        USECASE["DetectWhaleTransferUseCase.ts"]
    end

    subgraph DOMAIN["🏛️ Domain (핵심 규칙 — 순수 TypeScript)"]
        ENTITIES["Entities\nWhaleWallet · Transfer"]
        INTERFACES["Repository Interfaces\nIWhaleWalletRepository\nITransferRepository\nIExchangeAddressRepository\nISyncStateRepository"]
    end

    ALCHEMY --> VIEM
    MORALIS --> HBS
    POSTGRES --> REPOS
    TG_API --> NOTIF
    TG_API --> CMD

    VIEM --> TEL
    TEL --> USECASE
    TEL --> NOTIF
    HBS --> REPOS
    HBS --> INTERFACES

    USECASE --> INTERFACES
    REPOS -.->|implements| INTERFACES
    CMD --> REPOS

    ENTITIES --> INTERFACES
```

---

## 3. 클래스 다이어그램

### 3-1. Domain 레이어 — Entities & Repository Interfaces

```mermaid
classDiagram
    class WhaleWallet {
        +address: string
        +tokenAddress: string
        +label: string | undefined
        +createdAt: Date
        -_isActive: boolean
        +isActive: boolean
        +deactivate(): void
        +create(address, tokenAddress, label)$ WhaleWallet
        -isValidAddress(address)$ boolean
    }

    class Transfer {
        +txHash: string
        +logIndex: number
        +tokenAddress: string
        +from: string
        +to: string
        +value: bigint
        +blockNumber: bigint
        +blockTimestamp: Date
        +toType: ToType
        +isAlertTarget: boolean
        +uniqueId: string
        +create(props: TransferProps)$ Transfer
        -isValidTxHash(txHash)$ boolean
    }

    class IWhaleWalletRepository {
        <<interface>>
        +findByAddress(address, tokenAddress) WhaleWallet|null
        +findAllByToken(tokenAddress) WhaleWallet[]
        +upsert(address, tokenAddress, label) void
        +deactivateExcept(tokenAddress, activeAddresses) void
    }

    class ITransferRepository {
        <<interface>>
        +save(transfer) void
        +sumToExchange(whale, token) bigint
        +sumToExchangeSince(whale, token, since) bigint
        +sumAllFrom(whale, token) bigint
        +sumAllFromSince(whale, token, since) bigint
        +findRecentAlerts(token, limit) Transfer[]
        +getDailyExchangeVolume(token, days) DailyVolume[]
        +getTopSenders(token, since, limit) TopSender[]
        +sumAllToExchangeSince(token, since) bigint
        +findRecentByAddress(addr, token, limit) Transfer[]
        +getLastTransferTimestamp(addr, token) Date|null
    }

    class IExchangeAddressRepository {
        <<interface>>
        +isExchange(address) boolean
    }

    class ISyncStateRepository {
        <<interface>>
        +getOrCreate(tokenAddress) SyncState
        +setSyncing(tokenAddress, isSyncing) void
        +updateLastProcessedBlock(tokenAddress, blockNumber) void
    }

    IWhaleWalletRepository ..> WhaleWallet : returns
    ITransferRepository ..> Transfer : returns
```

### 3-2. Use Cases & Infrastructure 레이어

```mermaid
classDiagram
    class DetectWhaleTransferUseCase {
        -whaleWalletRepo: IWhaleWalletRepository
        -exchangeAddressRepo: IExchangeAddressRepository
        +execute(transfer) DetectionResult
    }

    class DetectionResult {
        <<interface>>
        +isWhale: boolean
        +isAlert: boolean
        +toType: ToType
    }

    class HistoricalBatchSync {
        -moralisApiKey: string
        -tokenAddress: string
        -lookbackDays: number
        -fallbackFromDate: Date
        +run() void
        -filterAndRank(holders) address+label 배열
        -resolveFromDate(address) Date
        -syncWallet(address, fromDate) number
        +fetchTopHolders() MoralisHolder[]
        +fetchTransfers(address, fromDate, cursor) MoralisTransferResponse
    }

    class TransferEventListener {
        -useCase: DetectWhaleTransferUseCase
        -transferRepo: ITransferRepository
        -notifier: TelegramNotifier
        -tokenAddress: string
        +start() void
        -handleLog(log) void
        -startOfToday() Date
    }

    class TelegramNotifier {
        -botToken: string
        -chatId: string
        -tokenSymbol: string
        +sendWhaleAlert(params) void
    }

    class TelegramCommandHandler {
        -botToken: string
        -transferRepo: ITransferRepository
        -tokenAddress: string
        -tokenSymbol: string
        +start() void
        +handleText(chatId, text) void
        -handleList(chatId) void
        -handleTop(chatId, text) void
        -handleWhale(chatId, text) void
        -handleToday(chatId) void
        -handleRecent(chatId) void
        -send(chatId, text) void
    }

    class PostgresWhaleWalletRepository {
        -pool: Pool
    }
    class PostgresTransferRepository {
        -pool: Pool
    }
    class PostgresExchangeAddressRepository {
        -pool: Pool
    }
    class PostgresSyncStateRepository {
        -pool: Pool
    }

    DetectWhaleTransferUseCase --> IWhaleWalletRepository : uses
    DetectWhaleTransferUseCase --> IExchangeAddressRepository : uses
    DetectWhaleTransferUseCase ..> DetectionResult : returns

    TransferEventListener --> DetectWhaleTransferUseCase : uses
    TransferEventListener --> ITransferRepository : uses
    TransferEventListener --> TelegramNotifier : uses

    HistoricalBatchSync --> IWhaleWalletRepository : uses
    HistoricalBatchSync --> IExchangeAddressRepository : uses
    HistoricalBatchSync --> ITransferRepository : uses
    HistoricalBatchSync --> ISyncStateRepository : uses

    TelegramCommandHandler --> ITransferRepository : uses

    PostgresWhaleWalletRepository ..|> IWhaleWalletRepository : implements
    PostgresTransferRepository ..|> ITransferRepository : implements
    PostgresExchangeAddressRepository ..|> IExchangeAddressRepository : implements
    PostgresSyncStateRepository ..|> ISyncStateRepository : implements
```

---

## 4. 시퀀스 — 애플리케이션 시작 흐름

`npm start` 실행 시 **배치 → TG 폴링 → 실시간 리스너** 순으로 시작된다.

```mermaid
sequenceDiagram
    participant Main as index.ts
    participant HBS as HistoricalBatchSync
    participant SyncRepo as SyncStateRepository
    participant Moralis as Moralis API
    participant ExRepo as ExchangeAddressRepository
    participant WhaleRepo as WhaleWalletRepository
    participant TransRepo as TransferRepository
    participant TCH as TelegramCommandHandler
    participant TEL as TransferEventListener

    Main->>HBS: batchSync.run()

    HBS->>SyncRepo: getOrCreate(tokenAddress)
    SyncRepo-->>HBS: { isSyncing: false }

    rect rgb(230, 245, 255)
        Note over HBS,ExRepo: ① 상위 홀더 조회 및 필터링
        HBS->>Moralis: GET /erc20/{token}/owners?limit=20
        Moralis-->>HBS: holders[20]
        loop 각 holder (비거래소 10개 확정될 때까지)
            HBS->>ExRepo: isExchange(holder.address)
            ExRepo-->>HBS: true / false
        end
    end

    rect rgb(255, 245, 230)
        Note over HBS,WhaleRepo: ② DB 지갑 목록 갱신
        HBS->>WhaleRepo: deactivateExcept(token, activeAddresses)
        loop 활성 지갑 10개 각각
            HBS->>WhaleRepo: upsert(address, token, "Top N Holder (X.XX%)")
        end
    end

    rect rgb(230, 255, 235)
        Note over HBS,TransRepo: ③ 지갑별 과거 이력 수집
        HBS->>SyncRepo: setSyncing(token, true)
        HBS->>WhaleRepo: findAllByToken(token)
        WhaleRepo-->>HBS: whales[10]

        loop 각 whale 지갑
            HBS->>TransRepo: getLastTransferTimestamp(address, token)
            TransRepo-->>HBS: 마지막 저장 시각 (없으면 오늘 - 90일)
            loop Moralis 페이지네이션 (cursor 소진될 때까지)
                HBS->>Moralis: GET /{address}/erc20/transfers?...
                Moralis-->>HBS: { result[], cursor }
                loop 각 transfer (value > 0)
                    HBS->>ExRepo: isExchange(to_address)
                    ExRepo-->>HBS: true / false
                    HBS->>TransRepo: save(Transfer)
                end
            end
        end
        HBS->>SyncRepo: setSyncing(token, false)
    end

    HBS-->>Main: 배치 완료

    Note over Main: 3초 대기 (WSL2 네트워크 안정화)

    Main->>TCH: commandHandler.start()
    Note over TCH: Long Polling 루프 시작 (fire & forget)

    Main->>TEL: listener.start()
    Note over TEL: Alchemy WebSocket 구독 시작
```

---

## 5. 시퀀스 — 실시간 Transfer 감지

Alchemy WebSocket에서 이벤트가 도착할 때마다 실행된다.

```mermaid
sequenceDiagram
    participant WS as Alchemy WebSocket
    participant TEL as TransferEventListener
    participant viem as wsClient (viem)
    participant UC as DetectWhaleTransferUseCase
    participant WhaleRepo as WhaleWalletRepository
    participant ExRepo as ExchangeAddressRepository
    participant TransRepo as TransferRepository
    participant TN as TelegramNotifier
    participant TG as Telegram Bot API

    WS->>TEL: Transfer 이벤트 emit (log)
    TEL->>viem: getBlock({ blockNumber })
    viem-->>TEL: block.timestamp

    TEL->>TEL: Transfer.create({ toType: "unknown" })

    TEL->>UC: execute(transfer)
    UC->>WhaleRepo: findByAddress(from, tokenAddress)

    alt from 주소가 세력 지갑이 아닌 경우
        WhaleRepo-->>UC: null
        UC-->>TEL: { isWhale: false, isAlert: false }
        Note over TEL: 무시하고 종료
    else from 주소가 세력 지갑인 경우
        WhaleRepo-->>UC: WhaleWallet
        UC->>ExRepo: isExchange(to)
        ExRepo-->>UC: true / false
        UC-->>TEL: { isWhale: true, isAlert: true, toType: exchange|unknown }

        TEL->>TEL: Transfer.create({ toType: result.toType })
        TEL->>TransRepo: save(transfer)

        par 누적량 병렬 조회
            TEL->>TransRepo: sumAllFrom(from, token)
        and
            TEL->>TransRepo: sumAllFromSince(from, token, startOfToday)
        end
        TransRepo-->>TEL: totalEver (전체 누적)
        TransRepo-->>TEL: totalToday (오늘 누적)

        TEL->>TN: sendWhaleAlert({ from, to, value, totalToday, totalEver, toType })

        Note over TN: toType에 따라 🏦 거래소 / ❓ 미확인 표시
        TN->>TG: POST /sendMessage (Markdown)
        TG-->>TN: 200 OK
    end
```

---

## 6. 시퀀스 — Telegram 명령어 처리

`commandHandler.start()` 이후 무한 루프로 실행된다.
Long Polling (`timeout=30`)으로 새 메시지를 대기한다.

```mermaid
sequenceDiagram
    actor User as 사용자 (Telegram)
    participant TG as Telegram Bot API
    participant TCH as TelegramCommandHandler
    participant DB as TransferRepository (PostgreSQL)

    loop 무한 Long Polling
        TCH->>TG: GET /getUpdates?offset=N&timeout=30
        Note over TG: 최대 30초 대기 후 응답
        User->>TG: 명령어 입력
        TG-->>TCH: updates[{ update_id, chat.id, text }]
        TCH->>TCH: offset = update_id + 1

        alt /list
            TCH->>DB: getDailyExchangeVolume(token, 7)
            DB-->>TCH: DailyVolume[] — 최근 7일 일별 전송량
            TCH->>TG: POST /sendMessage
            TG-->>User: 📊 최근 7일 세력 전송량

        else /top [N]
            Note over TCH: N 미입력 시 기본값 30일
            TCH->>DB: getTopSenders(token, since, 5)
            DB-->>TCH: TopSender[] — 상위 5개 주소 + 합산량
            TCH->>TG: POST /sendMessage
            TG-->>User: 🏆 최근 N일 TOP 5 세력 지갑

        else /whale 0x주소
            par 병렬 조회
                TCH->>DB: sumAllFrom(address, token)
            and
                TCH->>DB: findRecentByAddress(address, token, 5)
            end
            DB-->>TCH: total — 전체 누적 전송량
            DB-->>TCH: recent[5] — 최근 5건 Transfer
            TCH->>TG: POST /sendMessage
            TG-->>User: 🐋 지갑 누적량 + 최근 5건

        else /today
            Note over TCH: UTC 0시 기준으로 today 계산
            TCH->>DB: sumAllToExchangeSince(token, startOfUTCDay)
            DB-->>TCH: total — 오늘 전체 전송량
            TCH->>TG: POST /sendMessage
            TG-->>User: 📅 오늘 세력 전송량

        else /recent
            TCH->>DB: findRecentAlerts(token, 10)
            DB-->>TCH: Transfer[10] — 최근 감지 10건
            TCH->>TG: POST /sendMessage
            TG-->>User: 🔔 최근 감지 10건
        end
    end
```

---

## 참고 — 환경변수 목록

| 변수 | 필수 | 설명 |
|------|------|------|
| `TOKEN_ADDRESS` | ✅ | 추적할 ERC-20 토큰 컨트랙트 주소 |
| `TOKEN_SYMBOL` | ✅ | 토큰 심볼 (Telegram 메시지에 표시) |
| `ALCHEMY_API_KEY` | ✅ | Alchemy WebSocket/HTTP 키 |
| `MORALIS_API_KEY` | ✅ | Moralis REST API 키 |
| `TG_BOT_KEY` | ✅ | BotFather에서 발급한 봇 토큰 |
| `TG_CHAT_ID` | ✅ | 알림 수신 채팅방 ID |
| `DB_HOST` | ✅ | PostgreSQL 호스트 |
| `DB_PORT` | ✅ | PostgreSQL 포트 |
| `DB_NAME` | ✅ | DB 이름 |
| `DB_USER` | ✅ | DB 사용자 |
| `DB_PASSWORD` | ✅ | DB 비밀번호 |
| `BATCH_LOOKBACK_DAYS` | ❌ | 배치 조회 기간 (기본값: 90일) |
