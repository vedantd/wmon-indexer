import { WebSocketProvider, ethers } from 'ethers';
import { WSS_URL } from './config';
import { startTransferListener } from './listeners/transferListener';
import { getTopHolders, getStats } from './trackers/balanceTracker';
import { 
  onGroupedTransaction, 
  flushPendingTransactions, 
  getGrouperStats 
} from './trackers/transactionGrouper';
import { testConnection } from './db/supabase';
import { insertGroupedTransaction, getTransferCount } from './db/transferRepository';
import { startApiServer, emitGroupedTransaction, emitStats, emitHolders } from './api/server';
import { GroupedTransaction } from './types';

// Track DB stats
let dbInsertCount = 0;
let dbInsertErrors = 0;

// Reconnection state
let currentProvider: WebSocketProvider | null = null;
let reconnectAttempts = 0;
let disconnectCount = 0; // Track disconnects to apply backoff even after "successful" connects
let lastStableConnection = 0; // Timestamp of last stable connection (>30s without error)
let isReconnecting = false; // Prevent multiple simultaneous reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_DELAY_MS = 10000; // Start with 10 seconds
const MAX_DELAY_MS = 5 * 60 * 1000; // Max 5 minutes between attempts
const STABLE_CONNECTION_THRESHOLD = 30000; // Connection is "stable" after 30s without errors
let dbConnected = false;

// Entry point - keep this file thin!
// All heavy logic goes into listeners/ and trackers/

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 WMON Multi-Transfer Transaction Tracker');
  console.log('═'.repeat(60));
  console.log('Demonstrates: Grouping multiple ERC-20 transfers by transaction');
  console.log('Now with Supabase persistence! 💾');
  console.log('');

  // Test database connection
  console.log('Testing Supabase connection...');
  dbConnected = await testConnection();
  if (dbConnected) {
    const existingCount = await getTransferCount();
    console.log(`✅ Database connected! (${existingCount} transfers in DB)`);
  } else {
    console.log('⚠️  Database not ready - running in memory-only mode');
    console.log('   Create the "transfers" table in Supabase to enable persistence.');
  }
  console.log('');

  // Start API server
  startApiServer();
  console.log('');

  // Register callback for grouped transactions (only once!)
  onGroupedTransaction(async (groupedTx) => {
    displayGroupedTransaction(groupedTx);
    
    // Emit to WebSocket clients (REAL-TIME!)
    emitGroupedTransaction(groupedTx);
    
    // Emit updated stats and holders
    const stats = {
      session: {
        transfersProcessed: getStats().totalTransfers,
        uniqueHolders: getStats().totalHolders,
        multiTransferTxs: getGrouperStats().totalMultiTransferTxs,
        maxTransfersInOneTx: getGrouperStats().maxTransfersInOneTx,
      }
    };
    emitStats(stats);
    emitHolders(getTopHolders(20));
    
    // Persist to database
    if (dbConnected) {
      const success = await insertGroupedTransaction(groupedTx);
      if (success) {
        dbInsertCount += groupedTx.transfers.length;
      } else {
        dbInsertErrors++;
      }
    }
  });

  // Connect with reconnection support
  await connectWithRetry();

  // Print summary stats every 60 seconds
  setInterval(() => {
    printDashboard(dbConnected);
  }, 60000);

  // Health check every 30 seconds - verify connection is alive
  setInterval(async () => {
    if (!currentProvider || isReconnecting) return;
    
    try {
      // Try to get block number - if this fails, connection is dead
      await Promise.race([
        currentProvider.getBlockNumber(),
        sleep(10000).then(() => { throw new Error('Health check timeout'); })
      ]);
    } catch (err: any) {
      console.error('❌ Health check failed:', err.message || err);
      handleDisconnect();
    }
  }, 30000);

  // Keep alive forever (for production)
  console.log('🟢 Running indefinitely... (Ctrl+C to stop)\n');
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\n📴 Shutting down gracefully...');
    flushPendingTransactions();
    if (currentProvider) {
      await currentProvider.destroy();
    }
    if (dbConnected) {
      const finalCount = await getTransferCount();
      console.log(`💾 Final DB count: ${finalCount} transfers`);
    }
    console.log('👋 Goodbye!');
    process.exit(0);
  });
}

/**
 * Connect to WebSocket with exponential backoff retry
 */
async function connectWithRetry(): Promise<void> {
  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    try {
      console.log('Connecting to Monad via WebSocket...');
      
      // Create new provider
      currentProvider = new WebSocketProvider(WSS_URL);
      
      // Wait for connection
      await currentProvider.ready;
      console.log('✅ Connected!\n');
      
      // Reset reconnect counter on successful connection
      reconnectAttempts = 0;
      
      // Set up a timer to mark connection as stable after threshold
      setTimeout(() => {
        if (currentProvider) {
          lastStableConnection = Date.now();
          disconnectCount = 0; // Reset disconnect count after stable period
          console.log('✅ Connection stable for 30s, reset backoff counters');
        }
      }, STABLE_CONNECTION_THRESHOLD);
      
      // Start listening to transfers
      startTransferListener(currentProvider);
      
      // Flush pending transactions on each new block
      currentProvider.on('block', () => {
        flushPendingTransactions();
      });
      
      // Handle provider errors - trigger reconnection
      currentProvider.on('error', (err) => {
        console.error('❌ Provider error:', err.message || err);
        handleDisconnect();
      });
      
      // Also listen for WebSocket close events
      const wsSocket = (currentProvider as any)._websocket;
      if (wsSocket) {
        wsSocket.on('close', () => {
          console.log('⚠️  WebSocket closed');
          handleDisconnect();
        });
        wsSocket.on('error', (err: Error) => {
          console.error('❌ WebSocket error:', err.message || err);
          // Don't call handleDisconnect here, 'close' will follow
        });
      }
      
      return; // Successfully connected
      
    } catch (error: any) {
      reconnectAttempts++;
      
      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = Math.min(
        BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
        MAX_DELAY_MS
      );
      const jitter = Math.random() * 1000; // Add 0-1s jitter
      const delay = exponentialDelay + jitter;
      
      // Special handling for rate limiting (429)
      const isRateLimited = error.message?.includes('429') || error.code === 429;
      
      if (isRateLimited) {
        console.error(`⚠️  Rate limited (429). Waiting longer before retry...`);
        // Wait extra time for rate limits
        const rateLimitDelay = Math.min(delay * 2, MAX_DELAY_MS);
        console.log(`⏳ Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}: Retrying in ${Math.round(rateLimitDelay / 1000)}s...`);
        await sleep(rateLimitDelay);
      } else {
        console.error(`❌ Connection failed: ${error.message || error}`);
        console.log(`⏳ Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}: Retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      }
    }
  }
  
  // Exhausted all retries
  console.error(`💀 Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts. Exiting...`);
  process.exit(1);
}

/**
 * Handle disconnection - cleanup and reconnect
 */
async function handleDisconnect(): Promise<void> {
  // Prevent multiple simultaneous reconnection attempts
  if (isReconnecting) {
    console.log('🔄 Reconnection already in progress, skipping...');
    return;
  }
  isReconnecting = true;
  disconnectCount++;
  
  // Flush any pending data
  flushPendingTransactions();
  
  // Cleanup old provider
  if (currentProvider) {
    try {
      await currentProvider.destroy();
    } catch (e) {
      // Ignore cleanup errors
    }
    currentProvider = null;
  }
  
  // Calculate backoff based on how many times we've disconnected recently
  // If connection wasn't stable (failed within 30s), apply exponential backoff
  const timeSinceLastStable = Date.now() - lastStableConnection;
  const wasUnstable = timeSinceLastStable < STABLE_CONNECTION_THRESHOLD;
  
  let delay: number;
  if (wasUnstable) {
    // Connection keeps failing quickly - apply aggressive backoff
    delay = Math.min(BASE_DELAY_MS * Math.pow(2, disconnectCount - 1), MAX_DELAY_MS);
    const jitter = Math.random() * 5000; // Add 0-5s jitter
    delay += jitter;
    console.log(`\n⚠️  Connection unstable (failed after ${Math.round(timeSinceLastStable / 1000)}s)`);
    console.log(`⏳ Waiting ${Math.round(delay / 1000)}s before reconnect (attempt ${disconnectCount})...\n`);
  } else {
    // Connection was stable before failing - reset counter and use shorter delay
    disconnectCount = 1;
    delay = 5000; // 5 second delay for stable connections that dropped
    console.log('\n🔄 Connection dropped after stable period, reconnecting in 5s...\n');
  }
  
  await sleep(delay);
  
  // Try to reconnect
  try {
    await connectWithRetry();
  } catch (err) {
    console.error('Fatal reconnection error:', err);
    process.exit(1);
  } finally {
    isReconnecting = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Display a grouped transaction - highlights multi-transfer txs
 */
function displayGroupedTransaction(groupedTx: GroupedTransaction): void {
  const { transactionHash, blockNumber, transfers } = groupedTx;
  const txHashShort = `${transactionHash.slice(0, 10)}...${transactionHash.slice(-6)}`;

  if (transfers.length === 1) {
    // Single transfer - simple log
    const t = transfers[0];
    console.log(
      `   💸 ${shortenAddress(t.from)} → ${shortenAddress(t.to)} | ${formatValue(t.value)} WMON`
    );
  } else {
    // MULTI-TRANSFER TRANSACTION - This is what we want to showcase!
    console.log('');
    console.log('═'.repeat(60));
    console.log(`🔗 MULTI-TRANSFER TRANSACTION DETECTED (${transfers.length} transfers)`);
    console.log('═'.repeat(60));
    console.log(`TX: ${txHashShort}`);
    console.log(`Block: ${blockNumber}`);
    console.log('');
    
    transfers.forEach((t, i) => {
      console.log(
        `  [${t.logIndex}] ${shortenAddress(t.from)} → ${shortenAddress(t.to)} | ${formatValue(t.value)} WMON`
      );
    });

    // Try to identify the pattern
    const pattern = identifyPattern(transfers);
    if (pattern) {
      console.log('');
      console.log(`📋 Pattern: ${pattern}`);
    }
    console.log('═'.repeat(60));
    console.log('');
  }
}

/**
 * Try to identify common patterns in multi-transfer txs
 */
function identifyPattern(transfers: GroupedTransaction['transfers']): string | null {
  if (transfers.length === 2) {
    // Check if it's a simple swap (A→B, B→A with different amounts)
    if (transfers[0].from === transfers[1].to && transfers[0].to === transfers[1].from) {
      return 'Likely a swap (bidirectional transfer)';
    }
    // Check if same sender to multiple recipients
    if (transfers[0].from === transfers[1].from) {
      return 'Multi-send from same address';
    }
  }
  
  if (transfers.length >= 3) {
    // Check for router pattern (one address in the middle of all transfers)
    const allAddresses = transfers.flatMap(t => [t.from, t.to]);
    const addressCounts = new Map<string, number>();
    allAddresses.forEach(addr => {
      addressCounts.set(addr, (addressCounts.get(addr) || 0) + 1);
    });
    
    // Find if any address appears more than twice (likely a router/contract)
    for (const [addr, count] of addressCounts) {
      if (count >= 3) {
        return `Router/Contract pattern (${shortenAddress(addr)} involved in ${count} transfers)`;
      }
    }

    // Check if chain transfer (A→B→C→D)
    let isChain = true;
    for (let i = 1; i < transfers.length; i++) {
      if (transfers[i].from !== transfers[i-1].to) {
        isChain = false;
        break;
      }
    }
    if (isChain) {
      return 'Chain transfer (A→B→C→...)';
    }
  }

  return `Complex: ${transfers.length} transfers in 1 transaction`;
}

/**
 * Prints dashboard with multi-transfer stats
 */
function printDashboard(dbConnected: boolean): void {
  const balanceStats = getStats();
  const grouperStats = getGrouperStats();
  const topHolders = getTopHolders(5);

  console.log('\n' + '─'.repeat(60));
  console.log('📊 DASHBOARD');
  console.log('─'.repeat(60));
  console.log(`Total transfers processed: ${balanceStats.totalTransfers}`);
  console.log(`Unique holders tracked: ${balanceStats.totalHolders}`);
  console.log('');
  console.log('🔗 Multi-Transfer Transaction Stats:');
  console.log(`   Transactions with 2+ transfers: ${grouperStats.totalMultiTransferTxs}`);
  console.log(`   Max transfers in one tx: ${grouperStats.maxTransfersInOneTx}`);
  
  if (dbConnected) {
    console.log('');
    console.log('💾 Database Stats:');
    console.log(`   Transfers persisted this session: ${dbInsertCount}`);
    if (dbInsertErrors > 0) {
      console.log(`   Insert errors: ${dbInsertErrors}`);
    }
  }
  
  if (topHolders.length > 0) {
    console.log('\n🏆 Top 5 Holders:');
    topHolders.forEach((holder, i) => {
      const balanceStr = formatBalance(holder.balance);
      console.log(`   ${i + 1}. ${holder.address.slice(0, 10)}... → ${balanceStr} WMON`);
    });
  }
  console.log('─'.repeat(60) + '\n');
}

// Helper: shorten address for display
function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Helper: format bigint value to readable WMON (18 decimals)
function formatValue(value: bigint): string {
  const formatted = ethers.formatUnits(value, 18);
  const num = parseFloat(formatted);
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// Helper: format balance for display (18 decimals)
function formatBalance(value: bigint): string {
  const num = Number(value) / 1e18;
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Global error handlers to prevent crashes AND trigger reconnection
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message || err);
  
  // Check if this is a connection-related error that needs reconnection
  const errorMsg = err.message || String(err);
  const isConnectionError = 
    errorMsg.includes('429') || 
    errorMsg.includes('WebSocket') ||
    errorMsg.includes('ECONNREFUSED') ||
    errorMsg.includes('ETIMEDOUT') ||
    errorMsg.includes('socket hang up') ||
    errorMsg.includes('connection');
  
  if (isConnectionError) {
    console.log('🔌 Connection error detected, triggering reconnection...');
    handleDisconnect();
  }
});

process.on('unhandledRejection', (reason: any, promise) => {
  console.error('❌ Unhandled Rejection:', reason?.message || reason);
  
  // Check if this is a connection-related error
  const errorMsg = reason?.message || String(reason);
  const isConnectionError = 
    errorMsg.includes('429') || 
    errorMsg.includes('WebSocket') ||
    errorMsg.includes('ECONNREFUSED') ||
    errorMsg.includes('ETIMEDOUT') ||
    errorMsg.includes('socket hang up') ||
    errorMsg.includes('connection');
  
  if (isConnectionError) {
    console.log('🔌 Connection error detected, triggering reconnection...');
    handleDisconnect();
  }
});

main().catch((err) => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});

