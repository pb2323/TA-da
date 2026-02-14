import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer, type Server } from 'http';
import dotenv from 'dotenv';
import WebSocketHandler from './src/rtms/websocketHandler.js';
import applyHeaders from './src/utils/applyHeaders.js';
import { Logger } from './src/utils/logging.js';

const logger = new Logger('Server');

dotenv.config();

interface RTMSConfig {
  clientId: string;
  clientSecret: string;
}

const RTMS_CONFIG: RTMSConfig = {
  clientId: process.env.ZM_RTMS_CLIENT || '',
  clientSecret: process.env.ZM_RTMS_SECRET || '',
};

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies for webhooks
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply OWASP security headers to all requests
app.use((_req, res, next) => {
  applyHeaders(res);
  next();
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Root route - serve the HTML page
app.get('/', (_req: Request, res: Response) => {
  logger.debug('Serving HTML page for GET /');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create HTTP server
const server: Server = createServer(app);

// Initialize WebSocket handler with server and RTMS config
const wsHandler = new WebSocketHandler(server, RTMS_CONFIG);

// Webhook endpoint for RTMS events (CRITICAL for Zoom app to work)
app.post('/webhook', (req: Request, res: Response) => {
  logger.debug('Received webhook POST to /webhook');
  const webhookData = req.body;
  wsHandler.handleWebhookEvent(webhookData);
  res.status(200).send('OK');
});

// Start the HTTP server
server.listen(PORT, () => {
  logger.success(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Elasticsearch: ${process.env.ELASTIC_URL ? 'Configured' : 'Not configured'}`);
  logger.info(`📝 Index: ${process.env.ES_INDEX || 'ta-da-latest'}`);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await shutdown();
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await shutdown();
});

process.on('uncaughtException', async (error: Error) => {
  logger.error('Uncaught Exception:', error);
  await shutdown();
});

process.on(
  'unhandledRejection',
  async (reason: unknown, promise: Promise<unknown>) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdown();
  }
);

// Shutdown function
let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info('Starting graceful shutdown...');

  try {
    // Close WebSocket handler connections
    if (wsHandler) {
      await Promise.race([
        wsHandler.cleanup(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }

    // Close the HTTP server
    await Promise.race([
      new Promise<void>((resolve) => {
        server.close(() => {
          logger.debug('HTTP server closed');
          resolve();
        });
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);

    logger.success('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(0);
  }
}
