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
  const dbConnected = await testConnection();
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

  console.log('Connecting to Monad via WebSocket...');
  const provider = new WebSocketProvider(WSS_URL);
  
  await provider.ready;
  console.log('✅ Connected!\n');

  // Register callback for grouped transactions
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

  // Start listening to transfers
  startTransferListener(provider);

  // Flush pending transactions on each new block
  provider.on('block', (blockNumber) => {
    flushPendingTransactions();
  });

  // Print summary stats every 20 seconds
  const statsInterval = setInterval(() => {
    printDashboard(dbConnected);
  }, 20000);

  // Keep alive for 5 minutes
  console.log('Running for 5 minutes... (Ctrl+C to stop)\n');
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));

  clearInterval(statsInterval);
  flushPendingTransactions(); // Flush any remaining
  await provider.destroy();
  
  if (dbConnected) {
    const finalCount = await getTransferCount();
    console.log(`\n💾 Final DB count: ${finalCount} transfers`);
  }
  console.log('\n👋 Done');
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

main().catch(console.error);

