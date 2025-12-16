// In-memory balance tracker for WMON holders

// Storage: address → balance
const balances = new Map<string, bigint>();

// Track some stats
let totalTransfers = 0;

// Special address for mints/burns (zero address)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Called when a Transfer event is received.
 * Updates balances for both sender and receiver.
 */
export function updateBalance(from: string, to: string, value: bigint): void {
  totalTransfers++;

  // Decrease sender's balance (skip if mint from zero address)
  if (from !== ZERO_ADDRESS) {
    const fromBalance = balances.get(from) ?? 0n;
    balances.set(from, fromBalance - value);
  }

  // Increase receiver's balance (skip if burn to zero address)
  if (to !== ZERO_ADDRESS) {
    const toBalance = balances.get(to) ?? 0n;
    balances.set(to, toBalance + value);
  }
}

/**
 * Returns top N holders sorted by balance (highest first)
 */
export function getTopHolders(n: number): Array<{ address: string; balance: bigint }> {
  // Convert Map to array of {address, balance}
  const holders = Array.from(balances.entries()).map(([address, balance]) => ({
    address,
    balance,
  }));

  // Sort by balance descending (highest first)
  holders.sort((a, b) => {
    if (b.balance > a.balance) return 1;
    if (b.balance < a.balance) return -1;
    return 0;
  });

  // Return top N
  return holders.slice(0, n);
}

/**
 * Get basic stats about tracked data
 */
export function getStats(): { totalHolders: number; totalTransfers: number } {
  return {
    totalHolders: balances.size,
    totalTransfers,
  };
}
