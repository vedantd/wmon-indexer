import { supabase } from './supabase';
import { TransferEvent, GroupedTransaction } from '../types';

/**
 * Database row type for transfers table
 */
interface TransferRow {
  tx_hash: string;
  log_index: number;
  from_address: string;
  to_address: string;
  value: string;  // bigint stored as string
  block_number: number;
  timestamp: number;
}

/**
 * Insert a single transfer event.
 * Uses upsert to handle duplicates (idempotent).
 */
export async function insertTransfer(transfer: TransferEvent): Promise<boolean> {
  const row: TransferRow = {
    tx_hash: transfer.transactionHash,
    log_index: transfer.logIndex,
    from_address: transfer.from,
    to_address: transfer.to,
    value: transfer.value.toString(),
    block_number: transfer.blockNumber,
    timestamp: transfer.timestamp,
  };

  const { error } = await supabase
    .from('transfers')
    .upsert(row, { 
      onConflict: 'tx_hash,log_index',  // Idempotent: ignore duplicates
      ignoreDuplicates: true 
    });

  if (error) {
    console.error('Failed to insert transfer:', error.message);
    return false;
  }
  return true;
}

/**
 * Insert all transfers from a grouped transaction.
 * Batch insert for efficiency.
 */
export async function insertGroupedTransaction(groupedTx: GroupedTransaction): Promise<boolean> {
  const rows: TransferRow[] = groupedTx.transfers.map(transfer => ({
    tx_hash: transfer.transactionHash,
    log_index: transfer.logIndex,
    from_address: transfer.from,
    to_address: transfer.to,
    value: transfer.value.toString(),
    block_number: transfer.blockNumber,
    timestamp: transfer.timestamp,
  }));

  const { error } = await supabase
    .from('transfers')
    .upsert(rows, { 
      onConflict: 'tx_hash,log_index',
      ignoreDuplicates: true 
    });

  if (error) {
    console.error('Failed to insert grouped transaction:', error.message);
    return false;
  }
  return true;
}

/**
 * Get total count of transfers in database
 */
export async function getTransferCount(): Promise<number> {
  const { count, error } = await supabase
    .from('transfers')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Failed to get transfer count:', error.message);
    return 0;
  }
  return count || 0;
}

/**
 * Get recent transfers from database
 */
export async function getRecentTransfers(limit: number = 10): Promise<TransferEvent[]> {
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .order('block_number', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to get recent transfers:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    transactionHash: row.tx_hash,
    logIndex: row.log_index,
    from: row.from_address,
    to: row.to_address,
    value: BigInt(row.value),
    blockNumber: row.block_number,
    timestamp: row.timestamp,
  }));
}

/**
 * Get multi-transfer transactions (transactions with 2+ transfers)
 */
export async function getMultiTransferTxCount(): Promise<number> {
  const { data, error } = await supabase
    .rpc('count_multi_transfer_txs');

  if (error) {
    // Function might not exist yet, return 0
    return 0;
  }
  return data || 0;
}

/**
 * Get transfers grouped by transaction hash
 */
export async function getTransfersByTxHash(txHash: string): Promise<TransferEvent[]> {
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('tx_hash', txHash)
    .order('log_index', { ascending: true });

  if (error) {
    console.error('Failed to get transfers by tx hash:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    transactionHash: row.tx_hash,
    logIndex: row.log_index,
    from: row.from_address,
    to: row.to_address,
    value: BigInt(row.value),
    blockNumber: row.block_number,
    timestamp: row.timestamp,
  }));
}
