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
