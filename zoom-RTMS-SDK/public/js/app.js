// Zoom Transcripts App
(function () {
  'use strict';

  const logger = window.logger || console;

  // DOM elements
  const connectionStatus = document.getElementById('connectionStatus');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const meetingInfo = document.getElementById('meetingInfo');
  const transcriptsList = document.getElementById('transcriptsList');
  const totalChunks = document.getElementById('totalChunks');
  const speakerCount = document.getElementById('speakerCount');
  const lastUpdate = document.getElementById('lastUpdate');

  // State
  let ws = null;
  let reconnectTimer = null;
  let transcriptCount = 0;
  let speakers = new Set();
  let currentMeetingId = null;

  // Initialize WebSocket connection
  function connectWebSocket() {
    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/`;

    logger.debug('Connecting to WebSocket:', wsUrl);

    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      updateConnectionStatus('error');
      return;
    }

    ws.onopen = () => {
      logger.info('WebSocket connected');
      updateConnectionStatus('connected');

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        logger.error('Error parsing message:', error);
      }
    };

    ws.onclose = () => {
      logger.info('WebSocket disconnected');
      updateConnectionStatus('disconnected');

      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectWebSocket();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      logger.error('WebSocket error:', error);
      updateConnectionStatus('error');
    };
  }

  // Handle incoming messages
  function handleMessage(message) {
    logger.debug('Received message:', message);

    switch (message.type) {
      case 'connected':
        logger.info('Connected to server:', message.message);
        break;

      case 'meeting_started':
        logger.info('Meeting started');
        currentMeetingId = message.meetingUuid || message.streamId;
        resetTranscripts();
        updateMeetingInfo('Meeting in progress', message.meetingUuid);
        break;

      case 'meeting_stopped':
        logger.info('Meeting stopped');
        updateMeetingInfo('Meeting ended', currentMeetingId);
        break;

      case 'transcript':
        handleTranscript(message);
        break;

      default:
        logger.debug('Unknown message type:', message.type);
    }
  }

  // Handle transcript message
  function handleTranscript(data) {
    logger.debug('Transcript:', data);

    const speaker = data.speaker || 'Unknown';
    const text = data.text || '';
    const timestamp = data.timestamp || Date.now();

    // Update stats
    transcriptCount++;
    speakers.add(speaker);
    totalChunks.textContent = transcriptCount;
    speakerCount.textContent = speakers.size;
    lastUpdate.textContent = new Date().toLocaleTimeString();

    // Add transcript to list
    addTranscriptToList(speaker, text, timestamp);
  }

  // Add transcript to the UI
  function addTranscriptToList(speaker, text, timestamp) {
    // Remove empty state if present
    const emptyState = transcriptsList.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const transcriptItem = document.createElement('div');
    transcriptItem.className = 'transcript-item';

    const time = new Date(timestamp).toLocaleTimeString();

    transcriptItem.innerHTML = `
      <div class="transcript-header">
        <span class="transcript-speaker">${escapeHtml(speaker)}</span>
        <span class="transcript-time">${time}</span>
      </div>
      <div class="transcript-text">${escapeHtml(text)}</div>
    `;

    transcriptsList.appendChild(transcriptItem);

    // Auto-scroll to bottom
    transcriptsList.scrollTop = transcriptsList.scrollHeight;

    // Add fade-in animation
    setTimeout(() => {
      transcriptItem.classList.add('fade-in');
    }, 10);

    // Keep only last 100 transcripts
    const items = transcriptsList.querySelectorAll('.transcript-item');
    if (items.length > 100) {
      items[0].remove();
    }
  }

  // Update meeting info
  function updateMeetingInfo(status, meetingId) {
    meetingInfo.innerHTML = `
      <div class="meeting-status">
        <strong>Status:</strong> ${escapeHtml(status)}
        ${meetingId ? `<br><strong>Meeting ID:</strong> <code>${escapeHtml(meetingId)}</code>` : ''}
      </div>
    `;
  }

  // Reset transcripts
  function resetTranscripts() {
    transcriptsList.innerHTML = '<p class="empty-state">Transcripts will appear here when someone speaks.</p>';
    transcriptCount = 0;
    speakers.clear();
    totalChunks.textContent = '0';
    speakerCount.textContent = '0';
    lastUpdate.textContent = '-';
  }

  // Update connection status
  function updateConnectionStatus(status) {
    statusIndicator.className = `status-indicator ${status}`;

    switch (status) {
      case 'connected':
        statusText.textContent = 'Connected';
        break;
      case 'disconnected':
        statusText.textContent = 'Disconnected';
        break;
      case 'error':
        statusText.textContent = 'Connection Error';
        break;
      default:
        statusText.textContent = 'Unknown';
    }
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
  });

  // Handle page visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
      connectWebSocket();
    }
  });
})();
