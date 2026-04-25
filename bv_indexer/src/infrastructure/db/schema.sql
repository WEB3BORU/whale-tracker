-- ================================================================
-- whale_wallets: 추적할 세력 지갑 목록
-- ================================================================
CREATE TABLE IF NOT EXISTS whale_wallets (
  address     CHAR(42)    PRIMARY KEY,
  label       TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- exchange_addresses: 알려진 거래소 주소 목록
-- ================================================================
CREATE TABLE IF NOT EXISTS exchange_addresses (
  address     CHAR(42)    PRIMARY KEY,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- transfers: 감지된 ERC-20 Transfer 이벤트
-- ================================================================
CREATE TABLE IF NOT EXISTS transfers (
  tx_hash          CHAR(66)     NOT NULL,
  log_index        INTEGER      NOT NULL,
  from_address     CHAR(42)     NOT NULL,
  to_address       CHAR(42)     NOT NULL,
  value            NUMERIC(78)  NOT NULL,
  block_number     BIGINT       NOT NULL,
  block_timestamp  TIMESTAMPTZ  NOT NULL,
  to_type          TEXT         NOT NULL DEFAULT 'unknown',
  is_orphan        BOOLEAN      NOT NULL DEFAULT FALSE,

  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_transfers_from    ON transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_block   ON transfers(block_number);
CREATE INDEX IF NOT EXISTS idx_transfers_alert   ON transfers(to_type) WHERE to_type = 'exchange';

-- ================================================================
-- sync_state: 인덱서 동기화 진행 상태 (항상 1행)
-- ================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  id                    INTEGER     PRIMARY KEY DEFAULT 1,
  last_processed_block  BIGINT      NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT single_row CHECK (id = 1)
);
