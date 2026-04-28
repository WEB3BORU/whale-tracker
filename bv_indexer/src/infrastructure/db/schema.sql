-- ================================================================
-- whale_wallets: 추적할 세력 지갑 목록 (토큰별로 관리)
-- ================================================================
CREATE TABLE IF NOT EXISTS whale_wallets (
  address        CHAR(42)    NOT NULL,
  token_address  CHAR(42)    NOT NULL,
  label          TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (address, token_address)
);

-- ================================================================
-- exchange_addresses: 알려진 거래소 주소 목록 (토큰 무관 공통)
-- ================================================================
CREATE TABLE IF NOT EXISTS exchange_addresses (
  address     CHAR(42)    PRIMARY KEY,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- transfers: 감지된 ERC-20 Transfer 이벤트 (토큰 통합 테이블)
-- ================================================================
CREATE TABLE IF NOT EXISTS transfers (
  tx_hash          CHAR(66)     NOT NULL,
  log_index        INTEGER      NOT NULL,
  token_address    CHAR(42)     NOT NULL,
  from_address     CHAR(42)     NOT NULL,
  to_address       CHAR(42)     NOT NULL,
  value            NUMERIC(78)  NOT NULL,
  block_number     BIGINT       NOT NULL,
  block_timestamp  TIMESTAMPTZ  NOT NULL,
  to_type          TEXT         NOT NULL DEFAULT 'unknown',
  is_orphan        BOOLEAN      NOT NULL DEFAULT FALSE,

  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_transfers_token_from   ON transfers(token_address, from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_token_block  ON transfers(token_address, block_number);
CREATE INDEX IF NOT EXISTS idx_transfers_alert        ON transfers(token_address, to_type) WHERE to_type = 'exchange';

-- ================================================================
-- sync_state: 토큰별 동기화 상태
-- ================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  token_address         CHAR(42)    PRIMARY KEY,
  last_processed_block  BIGINT      NOT NULL DEFAULT 0,
  batch_synced_block    BIGINT,
  is_syncing            BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
