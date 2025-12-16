import { TransferEvent, GroupedTransaction } from '../types';

/**
 * Groups transfer events by transaction hash.
 * Buffers events until a new block arrives, then emits complete transactions.
 * 
 * This solves the interview question: "How do you handle multiple ERC-20 
 * transfers in a single transaction?"
 */

// Buffer: txHash → array of transfers in that tx
const pendingTransfers = new Map<string, TransferEvent[]>();

// Track the current block we're processing
let currentBlock: number | null = null;

// Callback for when a grouped transaction is ready
type TransactionCallback = (groupedTx: GroupedTransaction) => void;
let onTransactionReady: TransactionCallback | null = null;

// Stats
let totalMultiTransferTxs = 0;
let maxTransfersInOneTx = 0;

/**
 * Register a callback to be called when a transaction is fully grouped
 */
export function onGroupedTransaction(callback: TransactionCallback): void {
  onTransactionReady = callback;
}

/**
 * Add a transfer event to the grouper.
 * Events are buffered by txHash until the block changes.
 */
export function addTransfer(transfer: TransferEvent): void {
  const { transactionHash, blockNumber } = transfer;

  // If we've moved to a new block, flush the previous block's transactions
  if (currentBlock !== null && blockNumber > currentBlock) {
    flushPendingTransactions();
  }
  currentBlock = blockNumber;

  // Add to buffer
  const existing = pendingTransfers.get(transactionHash) || [];
  existing.push(transfer);
  pendingTransfers.set(transactionHash, existing);
}

/**
 * Force flush all pending transactions (call on shutdown or periodically)
 */
export function flushPendingTransactions(): void {
  for (const [txHash, transfers] of pendingTransfers.entries()) {
    // Sort by logIndex to ensure correct order
    transfers.sort((a, b) => a.logIndex - b.logIndex);

    const groupedTx: GroupedTransaction = {
      transactionHash: txHash,
      blockNumber: transfers[0].blockNumber,
      timestamp: transfers[0].timestamp,
      transfers,
    };

    // Track stats for multi-transfer txs
    if (transfers.length > 1) {
      totalMultiTransferTxs++;
      if (transfers.length > maxTransfersInOneTx) {
        maxTransfersInOneTx = transfers.length;
      }
    }

    // Emit the grouped transaction
    if (onTransactionReady) {
      onTransactionReady(groupedTx);
    }
  }

  // Clear the buffer
  pendingTransfers.clear();
}

/**
 * Get stats about multi-transfer transactions
 */
export function getGrouperStats(): {
  pendingTxCount: number;
  totalMultiTransferTxs: number;
  maxTransfersInOneTx: number;
} {
  return {
    pendingTxCount: pendingTransfers.size,
    totalMultiTransferTxs,
    maxTransfersInOneTx,
  };
}
