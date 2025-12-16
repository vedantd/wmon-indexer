import express, { Express } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { apiRouter } from './routes';
import { TransferEvent, GroupedTransaction } from '../types';

const PORT = process.env.PORT || 3000;

let app: Express | null = null;
let httpServer: HttpServer | null = null;
let io: SocketServer | null = null;

// Get the correct path for static files (works with ts-node and compiled JS)
const publicPath = path.join(process.cwd(), 'src', 'public');

/**
 * Start the API server with WebSocket support
 */
export function startApiServer(): Express {
  app = express();
  httpServer = createServer(app);
  
  // Initialize Socket.io
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Serve static frontend files
  app.use(express.static(publicPath));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api', apiRouter);

  // Serve index.html for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Socket.io connection handling
  io.on('connection', (socket) => {
    console.log(`   🔌 Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      console.log(`   🔌 Client disconnected: ${socket.id}`);
    });
  });

  // Start listening
  httpServer.listen(PORT, () => {
    console.log(`🌐 Server running at http://localhost:${PORT}`);
    console.log(`   📊 Dashboard: http://localhost:${PORT}`);
    console.log(`   📡 API: http://localhost:${PORT}/api/stats`);
    console.log(`   🔴 WebSocket: Real-time streaming enabled`);
  });

  return app;
}

/**
 * Emit a new transfer event to all connected clients
 */
export function emitTransfer(transfer: TransferEvent): void {
  if (io) {
    io.emit('transfer', {
      txHash: transfer.transactionHash,
      logIndex: transfer.logIndex,
      from: transfer.from,
      to: transfer.to,
      value: transfer.value.toString(),
      blockNumber: transfer.blockNumber,
    });
  }
}

/**
 * Emit a grouped transaction (especially useful for multi-transfer txs)
 */
export function emitGroupedTransaction(groupedTx: GroupedTransaction): void {
  if (io) {
    io.emit('groupedTx', {
      txHash: groupedTx.transactionHash,
      blockNumber: groupedTx.blockNumber,
      transferCount: groupedTx.transfers.length,
      isMultiTransfer: groupedTx.transfers.length > 1,
      transfers: groupedTx.transfers.map(t => ({
        logIndex: t.logIndex,
        from: t.from,
        to: t.to,
        value: t.value.toString(),
      })),
    });
  }
}

/**
 * Emit updated stats to all clients
 */
export function emitStats(stats: any): void {
  if (io) {
    io.emit('stats', stats);
  }
}

/**
 * Emit updated top holders to all clients
 */
export function emitHolders(holders: Array<{ address: string; balance: bigint }>): void {
  if (io) {
    io.emit('holders', holders.map(h => ({
      address: h.address,
      balance: h.balance.toString(),
    })));
  }
}
