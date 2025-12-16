// Represents a token holder's balance
export interface HolderBalance {
  address: string;
  balance: bigint;
  lastUpdatedBlock: number;
}

// Transfer event data after decoding
export interface TransferEvent {
  from: string;
  to: string;
  value: bigint;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;   // Position within the transaction (0, 1, 2...)
  timestamp: number;  // Unix timestamp in seconds (from block)
}

// A transaction that contains one or more transfers
export interface GroupedTransaction {
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  transfers: TransferEvent[];  // Sorted by logIndex
}
