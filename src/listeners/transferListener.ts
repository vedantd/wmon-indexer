import { WebSocketProvider, Log, ethers } from 'ethers';
import { CONTRACTS, TRANSFER_EVENT_TOPIC } from '../config';
import { updateBalance } from '../trackers/balanceTracker';
import { addTransfer } from '../trackers/transactionGrouper';
import { TransferEvent } from '../types';

// Store recent transfers for display
const recentTransfers: TransferEvent[] = [];
const MAX_RECENT = 10;

/**
 * Starts listening to WMON Transfer events.
 * Decodes each event, updates balance tracker, and groups by transaction.
 */
export function startTransferListener(provider: WebSocketProvider): void {
  console.log(`📡 Listening to WMON transfers at ${CONTRACTS.WMON}\n`);

  // Create filter for Transfer events on WMON contract
  const filter = {
    address: CONTRACTS.WMON,
    topics: [TRANSFER_EVENT_TOPIC],
  };

  // Subscribe to matching logs
  provider.on(filter, async (log: Log) => {
    try {
      const decoded = decodeTransferLog(log);
      
      // Update balances
      updateBalance(decoded.from, decoded.to, decoded.value);

      // Add to transaction grouper (handles multi-transfer txs)
      addTransfer(decoded);

      // Store in recent transfers
      recentTransfers.unshift(decoded);
      if (recentTransfers.length > MAX_RECENT) {
        recentTransfers.pop();
      }

    } catch (error) {
      console.error('Error processing transfer:', error);
    }
  });
}

/**
 * Decodes a raw Transfer log into structured data
 */
function decodeTransferLog(log: Log): TransferEvent {
  // Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
  // - topics[0] = event signature (TRANSFER_EVENT_TOPIC)
  // - topics[1] = from address (indexed, padded to 32 bytes)
  // - topics[2] = to address (indexed, padded to 32 bytes)
  // - data = value (uint256)

  const from = ethers.getAddress('0x' + log.topics[1].slice(26)); // Remove padding
  const to = ethers.getAddress('0x' + log.topics[2].slice(26));
  const value = BigInt(log.data);

  return {
    from,
    to,
    value,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,  // Position within the transaction
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Returns recent transfers (most recent first)
 */
export function getRecentTransfers(): TransferEvent[] {
  return recentTransfers;
}

// Helper: shorten address for display
function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Helper: format bigint value to readable WMON (18 decimals)
function formatValue(value: bigint): string {
  const formatted = ethers.formatUnits(value, 18);
  // Show max 4 decimal places
  const num = parseFloat(formatted);
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
