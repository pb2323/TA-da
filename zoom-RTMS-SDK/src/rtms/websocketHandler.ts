import rtms, { type RTMSClient } from '@zoom/rtms';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { WebSocket } from 'ws';
import { Logger } from '../utils/logging.js';
import { Client as ESClient } from '@elastic/elasticsearch';

const logger = new Logger('WebSocketHandler');

interface RTMSConfig {
  clientId: string;
  clientSecret: string;
}

interface WebhookData {
  event: string;
  payload: {
    rtms_stream_id?: string;
    meeting_uuid?: string;
    meetingUUID?: string;
    topic?: string;
    meeting_topic?: string;
    host_id?: string;
    hostId?: string;
    [key: string]: unknown;
  };
}

interface MeetingMetadata {
  meeting_start_time: string;
  meeting_topic: string | null;
  host_id: string | null;
  rtms_stream_id: string;
}

// Configure RTMS SDK logging
const rtmsLogLevel = (process.env.RTMS_LOG_LEVEL || 'disabled') as
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'disabled';
const rtmsLogEnabled = rtmsLogLevel !== 'disabled';

if (rtmsLogEnabled) {
  rtms.configureLogger({
    enabled: true,
    level: rtmsLogLevel,
    format: 'text',
  });
  logger.info(`RTMS SDK logging enabled with level: ${rtmsLogLevel}`);
} else {
  rtms.configureLogger({
    enabled: false,
    level: 'error',
    format: 'text',
  });
}

class WebSocketHandler {
  private rtmsConfig: RTMSConfig;
  private rtmsClients: Map<string, RTMSClient>;
  private wsConnections: Set<WebSocket>;
  private wss: WebSocketServer;
  private es: ESClient | null = null;
  private esConnected: boolean = false;
  private esIndex: string;
  private bulkBuffer: Array<unknown> = [];
  private bulkBatchSize: number;
  private bulkFlushInterval: NodeJS.Timeout | null = null;
  private meetingMetadata: Map<string, MeetingMetadata> = new Map();
  private meetingChunkCounters: Map<string, number> = new Map();

  constructor(server: Server, config: RTMSConfig) {
    this.rtmsConfig = config;
    this.rtmsClients = new Map();
    this.wsConnections = new Set();
    this.esIndex = process.env.ES_INDEX || 'ta-da-latest';
    this.bulkBatchSize = parseInt(process.env.ES_BULK_SIZE || '50', 10);
    const bulkFlushMs = parseInt(process.env.ES_BULK_FLUSH_MS || '2000', 10);

    // Initialize Elasticsearch
    this.initializeElasticsearch();

    // Initialize WebSocket server
    this.wss = new WebSocketServer({ server });
    this.setupWebSocketServer();

    // Start bulk flush interval
    this.bulkFlushInterval = setInterval(() => {
      this.flushBulk().catch((err) => logger.error('Bulk flush error:', err));
    }, bulkFlushMs);
  }

  private async initializeElasticsearch(): Promise<void> {
    const esUrl = process.env.ELASTIC_URL || process.env.ELASTICSEARCH_URL;

    if (!esUrl) {
      logger.warn('⚠️  No Elasticsearch URL configured. Transcripts will NOT be indexed.');
      return;
    }

    const esOpts: { node: string; auth?: { apiKey: string } } = { node: esUrl };
    if (process.env.ELASTIC_API_KEY) {
      esOpts.auth = { apiKey: process.env.ELASTIC_API_KEY };
    }

    this.es = new ESClient(esOpts);

    try {
      await this.es.ping();
      logger.success('✅ Elasticsearch connected successfully');
      this.esConnected = true;
    } catch (err) {
      logger.error('❌ Elasticsearch connection failed:', (err as Error).message);
      logger.error('Transcripts will NOT be indexed. Check ELASTIC_URL and ELASTIC_API_KEY.');
    }
  }

  private async flushBulk(): Promise<void> {
    if (!this.es || !this.esConnected || this.bulkBuffer.length === 0) return;

    const operations = this.bulkBuffer.flatMap((doc) => [
      { index: { _index: this.esIndex } },
      doc,
    ]);
    const batchSize = this.bulkBuffer.length;
    this.bulkBuffer = []; // Clear immediately

    try {
      const resp = await this.es.bulk({ operations, refresh: false });
      if (resp.errors) {
        const errors = resp.items.filter((i: { index?: { error?: unknown } }) => i.index?.error);
        logger.error(`❌ ES bulk errors (${errors.length}/${batchSize}):`, errors.slice(0, 3));
      } else {
        logger.info(`✅ Indexed ${batchSize} transcript chunks to ${this.esIndex}`);
      }
    } catch (e) {
      logger.error('❌ ES bulk request failed:', (e as Error).message);
    }
  }

  private nextChunkIndex(meetingId: string): number {
    const v = this.meetingChunkCounters.get(meetingId) || 0;
    this.meetingChunkCounters.set(meetingId, v + 1);
    return v;
  }

  private async appendTranscriptToES(doc: unknown): Promise<void> {
    if (!this.es || !this.esConnected) return;
    this.bulkBuffer.push(doc);
    if (this.bulkBuffer.length >= this.bulkBatchSize) {
      await this.flushBulk();
    }
  }

  private storeMeetingMetadata(meetingId: string, metadata: Partial<MeetingMetadata>): void {
    this.meetingMetadata.set(meetingId, {
      meeting_start_time: metadata.meeting_start_time || new Date().toISOString(),
      meeting_topic: metadata.meeting_topic || null,
      host_id: metadata.host_id || null,
      rtms_stream_id: metadata.rtms_stream_id || '',
    });
    logger.info(`📝 Stored metadata for meeting ${meetingId}`);
  }

  private getMeetingMetadata(meetingId: string): Partial<MeetingMetadata> {
    return this.meetingMetadata.get(meetingId) || {};
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('New WebSocket connection established');
      this.wsConnections.add(ws);

      ws.send(
        JSON.stringify({
          type: 'connected',
          message: 'Connected to Zoom transcript server',
        })
      );

      ws.on('close', () => {
        logger.debug('WebSocket connection closed');
        this.wsConnections.delete(ws);
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocket error:', error);
        this.wsConnections.delete(ws);
      });

      // Handle incoming messages from clients (e.g., help requests from students)
      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg && msg.type === 'help_request') {
            logger.info('Received help_request from client:', msg.studentName || 'unknown');
            // Broadcast help request to all connected clients (instructor UIs)
            this.broadcastToClients({
              type: 'help_request',
              studentName: msg.studentName || 'Student',
              feeling: msg.feeling || 'unknown',
              timestamp: msg.timestamp || Date.now(),
              message: msg.message || ''
            });
          }
        } catch (err) {
          logger.debug('Failed to parse client message:', err);
        }
      });
    });
  }

  private broadcastToClients(message: unknown): void {
    const messageStr = JSON.stringify(message);
    this.wsConnections.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  handleWebhookEvent(webhookData: WebhookData): void {
    const event = webhookData.event;
    const payload = webhookData.payload;

    logger.info(`[WEBHOOK] event: ${event}`);

    const streamId = payload?.rtms_stream_id as string | undefined;
    const meetingUuid = (payload?.meeting_uuid || payload?.meetingUUID) as string | undefined;

    if (event === 'meeting.rtms_stopped') {
      if (!streamId) {
        logger.warn('Received meeting.rtms_stopped without stream ID');
        return;
      }

      const client = this.rtmsClients.get(streamId);
      if (client) {
        client.leave();
        this.rtmsClients.delete(streamId);
      }

      // Flush pending transcripts
      this.flushBulk().catch((err) => logger.error('Flush error:', err));

      // Clean up metadata after delay
      if (meetingUuid) {
        setTimeout(() => {
          this.meetingMetadata.delete(meetingUuid);
          this.meetingChunkCounters.delete(meetingUuid);
        }, 60000);
      }

      this.broadcastToClients({
        type: 'meeting_stopped',
        streamId: streamId,
        message: 'Meeting RTMS stream has stopped',
      });

      return;
    }

    if (event !== 'meeting.rtms_started') {
      logger.debug(`Ignoring unknown event: ${event}`);
      return;
    }

    // Store meeting metadata
    if (meetingUuid) {
      this.storeMeetingMetadata(meetingUuid, {
        meeting_start_time: new Date().toISOString(),
        meeting_topic: (payload?.topic || payload?.meeting_topic) as string | null,
        host_id: (payload?.host_id || payload?.hostId) as string | null,
        rtms_stream_id: streamId || '',
      });
    }

    // Create RTMS client
    const client = new rtms.Client({
      clientId: this.rtmsConfig.clientId,
      clientSecret: this.rtmsConfig.clientSecret,
    });

    if (streamId) {
      this.rtmsClients.set(streamId, client);
    }

    this.broadcastToClients({
      type: 'meeting_started',
      streamId: streamId,
      meetingUuid: meetingUuid,
      message: 'Meeting RTMS stream has started',
    });

    // Handle transcript data
    client.onTranscriptData(async (data, _size, timestamp, metadata) => {
      const transcriptText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const speakerName = (metadata.userName as string) || 'Unknown';
      const userId = (metadata.userId as string) || null;

      logger.info(`[TRANSCRIPT] ${speakerName}: ${transcriptText}`);

      // Broadcast to frontend
      this.broadcastToClients({
        type: 'transcript',
        speaker: speakerName,
        text: transcriptText,
        timestamp: timestamp,
        userId: userId,
        streamId: streamId,
      });

      // Index to Elasticsearch
      if (meetingUuid) {
        const meetingMeta = this.getMeetingMetadata(meetingUuid);
        const doc = {
          meeting_id: meetingUuid,
          chunk_index: this.nextChunkIndex(meetingUuid),
          text: transcriptText,
          start_time: null, // RTMS SDK doesn't provide start/end times
          end_time: null,
          speaker_id: speakerName,
          meeting_start_time: meetingMeta.meeting_start_time || null,
          received_at: new Date().toISOString(),
          source: process.env.SOURCE_NAME || 'zoom_agent',
        };

        await this.appendTranscriptToES(doc).catch((err) =>
          logger.error('ES append error:', err)
        );
      }
    });

    // Join the meeting
    client.join(payload);
  }

  async cleanup(): Promise<void> {
    logger.info('Starting cleanup...');

    try {
      // Flush pending transcripts
      await this.flushBulk();

      // Clear bulk flush interval
      if (this.bulkFlushInterval) {
        clearInterval(this.bulkFlushInterval);
        this.bulkFlushInterval = null;
      }

      // Close WebSocket connections
      this.wsConnections.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'server_shutdown',
              message: 'Server is shutting down',
            })
          );
          ws.close();
        }
      });
      this.wsConnections.clear();

      // Leave all RTMS meetings
      for (const [streamId, client] of this.rtmsClients) {
        try {
          logger.debug(`Leaving RTMS stream: ${streamId}`);
          client.leave();
        } catch (error) {
          logger.error(`Error leaving stream ${streamId}:`, error);
        }
      }
      this.rtmsClients.clear();

      // Close WebSocket server
      if (this.wss) {
        await new Promise<void>((resolve) => {
          this.wss.close(() => {
            logger.debug('WebSocket server closed');
            resolve();
          });
        });
      }

      // Close Elasticsearch connection
      if (this.es) {
        await this.es.close();
        logger.debug('Elasticsearch connection closed');
      }

      logger.success('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}

export default WebSocketHandler;
