import { Router, Request, Response } from 'express';
import { getTopHolders, getStats } from '../trackers/balanceTracker';
import { getGrouperStats } from '../trackers/transactionGrouper';
import { 
  getRecentTransfers, 
  getTransferCount, 
  getTransfersByTxHash 
} from '../db/transferRepository';

export const apiRouter = Router();

/**
 * GET /api/holders
 * Returns top holders sorted by balance
 * Query params: ?limit=10 (default 20)
 */
apiRouter.get('/holders', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const holders = getTopHolders(limit);
    
    // Convert BigInt to string for JSON serialization
    const response = holders.map(h => ({
      address: h.address,
      balance: h.balance.toString(),
      balanceFormatted: formatBalance(h.balance),
    }));

    res.json({
      success: true,
      count: response.length,
      holders: response,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch holders' });
  }
});

/**
 * GET /api/transfers
 * Returns recent transfers
 * Query params: ?limit=10 (default 20)
 */
apiRouter.get('/transfers', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const transfers = await getRecentTransfers(limit);
    
    // Convert BigInt to string for JSON serialization
    const response = transfers.map(t => ({
      txHash: t.transactionHash,
      logIndex: t.logIndex,
      from: t.from,
      to: t.to,
      value: t.value.toString(),
      valueFormatted: formatBalance(t.value),
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
    }));

    res.json({
      success: true,
      count: response.length,
      transfers: response,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch transfers' });
  }
});

/**
 * GET /api/stats
 * Returns summary statistics
 */
apiRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const balanceStats = getStats();
    const grouperStats = getGrouperStats();
    const dbTransferCount = await getTransferCount();

    res.json({
      success: true,
      stats: {
        // In-memory stats (current session)
        session: {
          transfersProcessed: balanceStats.totalTransfers,
          uniqueHolders: balanceStats.totalHolders,
          multiTransferTxs: grouperStats.totalMultiTransferTxs,
          maxTransfersInOneTx: grouperStats.maxTransfersInOneTx,
        },
        // Database stats (all time)
        database: {
          totalTransfers: dbTransferCount,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/tx/:hash
 * Returns all transfers in a specific transaction
 */
apiRouter.get('/tx/:hash', async (req: Request, res: Response) => {
  try {
    const txHash = req.params.hash;
    
    if (!txHash || !txHash.startsWith('0x')) {
      return res.status(400).json({ success: false, error: 'Invalid transaction hash' });
    }

    const transfers = await getTransfersByTxHash(txHash);
    
    if (transfers.length === 0) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const response = transfers.map(t => ({
      logIndex: t.logIndex,
      from: t.from,
      to: t.to,
      value: t.value.toString(),
      valueFormatted: formatBalance(t.value),
    }));

    res.json({
      success: true,
      txHash,
      transferCount: response.length,
      isMultiTransfer: response.length > 1,
      transfers: response,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch transaction' });
  }
});

/**
 * GET /api/holders/address/:address
 * Get balance for a specific address
 */
apiRouter.get('/holders/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    
    if (!address || !address.startsWith('0x')) {
      return res.status(400).json({ success: false, error: 'Invalid address' });
    }

    // Find in top holders (we'd need a better approach for production)
    const holders = getTopHolders(1000);
    const holder = holders.find(h => h.address.toLowerCase() === address.toLowerCase());

    if (!holder) {
      return res.json({
        success: true,
        address,
        balance: '0',
        balanceFormatted: '0 WMON',
        note: 'Address not found in current session data',
      });
    }

    res.json({
      success: true,
      address: holder.address,
      balance: holder.balance.toString(),
      balanceFormatted: formatBalance(holder.balance),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch holder' });
  }
});

// Helper: format balance for display (18 decimals)
function formatBalance(value: bigint): string {
  const num = Number(value) / 1e18;
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' WMON';
}
