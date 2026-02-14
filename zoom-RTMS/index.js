import express from 'express';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import crypto from 'crypto';

// Load environment variables from .env
dotenv.config();

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
function handleWebhook(req, res) {
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
    console.log(`Starting RTMS for meeting ${meetingUuid}`);
    connectToSignalingWebSocket(meetingUuid, rtmsStreamId, signalingUrl);
  } else if (event === 'meeting.rtms_stopped') {
    console.log('Stopping RTMS for meeting', payload.meeting_uuid || payload.meetingUUID);
  } else {
    console.log('Other event:', event);
  }
  res.sendStatus(200);
}

app.post('/webhook', handleWebhook);
// So Zoom can POST to root if Event URL is set to https://your-ngrok.dev/
app.post('/', handleWebhook);

// Listen on localhost:3000
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});