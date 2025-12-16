-- WMON Transfer Tracker Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/qktuqokpbnosnkhemeyp/sql

-- Transfers table (source of truth)
CREATE TABLE IF NOT EXISTS transfers (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  value TEXT NOT NULL,  -- bigint stored as string to avoid precision issues
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Composite primary key: (tx_hash, log_index) ensures idempotent inserts
  PRIMARY KEY (tx_hash, log_index)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_transfers_timestamp ON transfers(timestamp DESC);

-- Function to count multi-transfer transactions
CREATE OR REPLACE FUNCTION count_multi_transfer_txs()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER 
  FROM (
    SELECT tx_hash 
    FROM transfers 
    GROUP BY tx_hash 
    HAVING COUNT(*) > 1
  ) sub;
$$ LANGUAGE SQL;

-- View: Recent transfers with readable format
CREATE OR REPLACE VIEW recent_transfers AS
SELECT 
  tx_hash,
  log_index,
  from_address,
  to_address,
  value,
  block_number,
  to_timestamp(timestamp) as time,
  created_at
FROM transfers
ORDER BY block_number DESC, log_index DESC
LIMIT 100;

-- View: Multi-transfer transactions summary
CREATE OR REPLACE VIEW multi_transfer_txs AS
SELECT 
  tx_hash,
  COUNT(*) as transfer_count,
  MIN(block_number) as block_number,
  array_agg(from_address ORDER BY log_index) as from_addresses,
  array_agg(to_address ORDER BY log_index) as to_addresses
FROM transfers
GROUP BY tx_hash
HAVING COUNT(*) > 1
ORDER BY block_number DESC
LIMIT 50;

-- Enable Row Level Security (optional but recommended)
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for now (adjust for production)
CREATE POLICY "Allow all operations" ON transfers
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant access to anon role
GRANT ALL ON transfers TO anon;
GRANT ALL ON recent_transfers TO anon;
GRANT ALL ON multi_transfer_txs TO anon;
