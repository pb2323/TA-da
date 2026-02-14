import express from 'express';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import crypto from 'crypto';
import { Client as ESClient } from '@elastic/elasticsearch';

// Load environment variables from .env
dotenv.config();

// Elasticsearch setup (use ta-da-latest as required by the repo)
const ES_INDEX = process.env.ES_INDEX || 'ta-da-latest';
let es = null;
let esConnected = false;

// Initialize Elasticsearch client
if (process.env.ELASTIC_URL || process.env.ELASTICSEARCH_URL) {
  const esUrl = process.env.ELASTIC_URL || process.env.ELASTICSEARCH_URL;
  const esOpts = { node: esUrl };
  if (process.env.ELASTIC_API_KEY) {
    esOpts.auth = { apiKey: process.env.ELASTIC_API_KEY };
  }
  es = new ESClient(esOpts);

  // Test connection on startup
  es.ping()
    .then(() => {
      console.log('✅ Elasticsearch connected successfully');
      esConnected = true;
    })
    .catch(err => {
      console.error('❌ Elasticsearch connection failed:', err.message);
      console.error('Transcripts will NOT be indexed. Check ELASTIC_URL and ELASTIC_API_KEY.');
    });
} else {
  console.warn('⚠️  No Elasticsearch URL configured. Set ELASTIC_URL or ELASTICSEARCH_URL to enable indexing.');
}

// Simple per-meeting chunk counter to provide `chunk_index`
const meetingChunkCounters = new Map();

// Store meeting metadata (meeting_id -> { start_time, title, etc. })
const meetingMetadata = new Map();

// Bulk buffer for append-only indexing
let bulkBuffer = [];
const BULK_BATCH_SIZE = parseInt(process.env.ES_BULK_SIZE || '50', 10);
const BULK_FLUSH_MS = parseInt(process.env.ES_BULK_FLUSH_MS || '2000', 10);

async function flushBulk() {
  if (!es || !esConnected || bulkBuffer.length === 0) return;
  const operations = bulkBuffer.flatMap(doc => [{ index: { _index: ES_INDEX } }, doc]);
  const batchSize = bulkBuffer.length;
  bulkBuffer = []; // Clear immediately to avoid duplicates

  try {
    const resp = await es.bulk({ operations, refresh: false });
    if (resp.errors) {
      const errors = resp.items.filter(i => i.index?.error);
      console.error(`❌ ES bulk errors (${errors.length}/${batchSize}):`, errors.slice(0, 3));
    } else {
      console.log(`✅ Indexed ${batchSize} transcript chunks to ${ES_INDEX}`);
    }
  } catch (e) {
    console.error('❌ ES bulk request failed:', e.message);
  }
}

function nextChunkIndex(meetingId) {
  const v = meetingChunkCounters.get(meetingId) || 0;
  meetingChunkCounters.set(meetingId, v + 1);
  return v;
}

async function appendTranscriptToES(doc) {
  if (!es || !esConnected) return;
  bulkBuffer.push(doc);
  if (bulkBuffer.length >= BULK_BATCH_SIZE) await flushBulk();
}

// Store meeting metadata for enriching transcript chunks
function storeMeetingMetadata(meetingId, metadata) {
  meetingMetadata.set(meetingId, {
    meeting_start_time: metadata.meeting_start_time || new Date().toISOString(),
    meeting_topic: metadata.meeting_topic || null,
    host_id: metadata.host_id || null,
    ...metadata
  });
  console.log(`📝 Stored metadata for meeting ${meetingId}`);
}

// Get meeting metadata for a meeting ID
function getMeetingMetadata(meetingId) {
  return meetingMetadata.get(meetingId) || {};
}

const app = express();

// Enable JSON body parsing
app.use(express.json());

// Basic root route for testing
app.get('/', (req, res) => {
  res.send('Zoom RTMS Server is up and running.');
});

// Log every incoming request (helps debug if Zoom is reaching the server)
app.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log(`[INCOMING] ${req.method} ${req.url}`);
  }
  next();
});

// Generate signature for RTMS authentication
function generateSignature(meetingUuid, rtmsStreamId) {
  const message = `${process.env.ZOOM_CLIENT_ID},${meetingUuid},${rtmsStreamId}`;
  const signature = crypto
    .createHmac('sha256', process.env.ZOOM_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  console.log(`Generated signature: ${signature}`);
  return signature;
}

// Connect to media WebSocket for receiving transcript data
function connectToMediaWebSocket(mediaUrl, meetingUuid, rtmsStreamId, signalingSocket) {
  const mediaWs = new WebSocket(mediaUrl);

  mediaWs.on('open', () => {
    console.log('Media WebSocket connected');
    const handshakeMsg = {
      msg_type: 3, // DATA_HAND_SHAKE_REQ
      protocol_version: 1,
      sequence: 0,
      meeting_uuid: meetingUuid,
      rtms_stream_id: rtmsStreamId,
      signature: generateSignature(meetingUuid, rtmsStreamId),
      media_type: 8 // TRANSCRIPT only
    };
    console.log('Sending transcript handshake:', handshakeMsg);
    mediaWs.send(JSON.stringify(handshakeMsg));
  });

  mediaWs.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('Media WS: invalid JSON', data?.toString?.());
      return;
    }

    // Debug: log every message type (skip noisy keep-alive in debug)
    if (msg.msg_type !== 12) {
      console.log('[MEDIA] msg_type:', msg.msg_type, msg.msg_type === 17 ? 'TRANSCRIPT' : '');
    }

    // Handle media handshake response
    if (msg.msg_type === 4 && msg.status_code === 0) {
      console.log('Media handshake successful, sending CLIENT_READY_ACK');
      signalingSocket.send(JSON.stringify({
        msg_type: 7, // CLIENT_READY_ACK
        rtms_stream_id: rtmsStreamId
      }));
    }
    // Handle transcript data (msg_type 17); Zoom may use different field names
    else if (msg.msg_type === 17) {
      const content = msg.content || msg.payload || msg;
      const userName = content.user_name ?? content.userName ?? content.speaker ?? 'Unknown';
      const text = content.data ?? content.text ?? content.transcript ?? content.content ?? JSON.stringify(content);
      console.log(`[TRANSCRIPT] ${userName}: ${text}`);

      // Get meeting metadata to enrich the document
      const metadata = getMeetingMetadata(meetingUuid);

      // Build ta-da-latest compliant document
      const doc = {
        meeting_id: meetingUuid,
        chunk_index: nextChunkIndex(meetingUuid),
        text,
        start_time: (content.start_ms != null) ? (content.start_ms / 1000.0) : null,
        end_time: (content.end_ms != null) ? (content.end_ms / 1000.0) : null,
        speaker_id: userName,
        meeting_start_time: metadata.meeting_start_time || null,
        received_at: new Date().toISOString(),
        source: process.env.SOURCE_NAME || 'zoom_agent'
      };

      // Non-blocking append to ES (bulk)
      appendTranscriptToES(doc).catch(err => console.error('appendTranscriptToES error', err));
    }
    // Unknown message type - log once so we can fix if Zoom uses different type for transcript
    else if (msg.msg_type !== 12) {
      console.log('[MEDIA] Other message:', JSON.stringify(msg).slice(0, 300));
    }
    // Handle keep-alive
    if (msg.msg_type === 12) {
      mediaWs.send(JSON.stringify({
        msg_type: 13, // KEEP_ALIVE_ACK
        timestamp: msg.timestamp
      }));
    }
  });

  mediaWs.on('error', (error) => {
    console.error('Media WebSocket error:', error);
  });

  mediaWs.on('close', (code, reason) => {
    console.log('Media WebSocket closed:', code, reason);
  });
}

// Connect to signaling WebSocket
function connectToSignalingWebSocket(meetingUuid, rtmsStreamId, serverUrls) {
  const signalingWs = new WebSocket(serverUrls);

  signalingWs.on('open', () => {
    console.log(`Signaling WebSocket opened for meeting ${meetingUuid}`);

    const signature = generateSignature(meetingUuid, rtmsStreamId);

    const handshakeMsg = {
      msg_type: 1, // SIGNALING_HAND_SHAKE_REQ
      meeting_uuid: meetingUuid,
      rtms_stream_id: rtmsStreamId,
      signature
    };

    console.log('Sending handshake message:', handshakeMsg);
    signalingWs.send(JSON.stringify(handshakeMsg));
  });

  signalingWs.on('message', (data) => {
    const msg = JSON.parse(data);
    
    // Handle signaling handshake response
    if (msg.msg_type === 2 && msg.status_code === 0) {
      console.log('Signaling handshake successful');
      const transcriptUrl = msg.media_server?.server_urls?.transcript || msg.media_server?.server_urls?.transcript_url;
      if (!transcriptUrl) {
        console.error('No transcript URL in response:', JSON.stringify(msg, null, 2));
        return;
      }
      connectToMediaWebSocket(transcriptUrl, meetingUuid, rtmsStreamId, signalingWs);
    }
    
    // Handle keep-alive requests
    else if (msg.msg_type === 12) { // KEEP_ALIVE_REQ
      console.log('Received KEEP_ALIVE_REQ, responding with KEEP_ALIVE_RESP');
      signalingWs.send(JSON.stringify({
        msg_type: 13, // KEEP_ALIVE_RESP
        timestamp: msg.timestamp
      }));
    }
  });

  signalingWs.on('error', (error) => {
    console.error('Signaling WebSocket error:', error);
  });

  signalingWs.on('close', (code, reason) => {
    console.log('Signaling WebSocket closed:', code, reason);
  });
}

// Handle webhook - support both POST / and POST /webhook (Zoom may use either)
async function handleWebhook(req, res) {
  const body = req.body || {};
  const event = body.event;
  const payload = body.payload || body;

  console.log('[WEBHOOK] event:', event, 'payload keys:', Object.keys(payload));

  if (event === 'meeting.rtms_started') {
    // Zoom may send meeting_uuid or meetingUUID; server_urls may be nested
    const meetingUuid = payload.meeting_uuid || payload.meetingUUID;
    const rtmsStreamId = payload.rtms_stream_id || payload.rtmsStreamId;
    const serverUrls = payload.server_urls || payload.serverUrls || payload.media_server?.server_urls;

    if (!meetingUuid || !rtmsStreamId || !serverUrls) {
      console.error('[WEBHOOK] Missing fields. payload:', JSON.stringify(payload, null, 2));
      res.sendStatus(200);
      return;
    }
    // Zoom may send server_urls as a string (signaling URL) or object (e.g. { signaling: "wss://..." })
    const signalingUrl = typeof serverUrls === 'string' ? serverUrls : (serverUrls.signaling || serverUrls.signaling_url || Object.values(serverUrls)[0]);
    if (!signalingUrl) {
      console.error('[WEBHOOK] No signaling URL in server_urls:', serverUrls);
      res.sendStatus(200);
      return;
    }

    // Store meeting metadata for enriching transcript documents
    storeMeetingMetadata(meetingUuid, {
      meeting_start_time: new Date().toISOString(),
      meeting_topic: payload.topic || payload.meeting_topic || null,
      host_id: payload.host_id || payload.hostId || null,
      rtms_stream_id: rtmsStreamId
    });

    console.log(`🚀 Starting RTMS for meeting ${meetingUuid}`);
    connectToSignalingWebSocket(meetingUuid, rtmsStreamId, signalingUrl);
  } else if (event === 'meeting.rtms_stopped') {
    const meetingUuid = payload.meeting_uuid || payload.meetingUUID;
    console.log(`🛑 Stopping RTMS for meeting ${meetingUuid}`);

    // Flush any pending transcripts for this meeting
    await flushBulk();

    // Clean up metadata after a delay (in case late transcripts arrive)
    setTimeout(() => {
      meetingMetadata.delete(meetingUuid);
      meetingChunkCounters.delete(meetingUuid);
    }, 60000); // 1 minute
  } else {
    console.log('Other event:', event);
  }
  res.sendStatus(200);
}

app.post('/webhook', handleWebhook);
// So Zoom can POST to root if Event URL is set to https://your-ngrok.dev/
app.post('/', handleWebhook);

// Store complete meeting details (optional - for querying meeting metadata separately)
app.post('/meeting/metadata', async (req, res) => {
  const { meeting_id, meeting_topic, host_id, start_time, duration, participants } = req.body;

  if (!meeting_id) {
    return res.status(400).json({ error: 'meeting_id is required' });
  }

  storeMeetingMetadata(meeting_id, {
    meeting_start_time: start_time || new Date().toISOString(),
    meeting_topic,
    host_id,
    duration,
    participants
  });

  res.json({ ok: true, message: 'Meeting metadata stored' });
});

// Debug route: push a sample transcript chunk into ta-da-latest (for demos)
app.post('/debug/push-sample', async (req, res) => {
  const body = req.body || {};
  const meetingId = body.meeting_id || body.meetingUuid || body.meeting_id || 'debug-meeting-1';
  const text = body.text || 'This is a sample transcript chunk for debugging.';
  const speaker = body.speaker_id || body.speaker || 'instructor';
  const start_time = body.start_time ?? 0.0;
  const end_time = body.end_time ?? null;

  const doc = {
    meeting_id: meetingId,
    chunk_index: nextChunkIndex(meetingId),
    text,
    start_time,
    end_time,
    speaker_id: speaker,
    meeting_start_time: body.meeting_start_time ?? null,
    received_at: new Date().toISOString(),
    source: process.env.SOURCE_NAME || 'zoom_agent'
  };

  try {
    await appendTranscriptToES(doc);
    res.json({ ok: true, doc });
  } catch (e) {
    console.error('debug push error', e);
    res.status(500).json({ error: 'failed to index sample chunk' });
  }
});

// Listen on localhost:3000
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server is listening on http://localhost:${PORT}`);
  console.log(`📊 Elasticsearch: ${esConnected ? '✅ Connected' : '❌ Not connected'}`);
  console.log(`📝 Index: ${ES_INDEX}`);
});

// Graceful shutdown - flush pending transcripts before exit
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Flushing pending transcripts...`);
  clearInterval(bulkFlushInterval);
  await flushBulk();
  console.log('✅ Shutdown complete');
  server.close(() => process.exit(0));
}

const bulkFlushInterval = setInterval(flushBulk, BULK_FLUSH_MS);
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));