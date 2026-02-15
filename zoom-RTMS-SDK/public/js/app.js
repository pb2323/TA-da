// Live TA - Learning Moments Dashboard
// Production-quality interactive frontend
(function () {
  'use strict';

  const logger = window.logger || console;

  // ==================== STATE ====================
  const state = {
    concepts: [],
    feeling: null,
    understandingHistory: [],
    isHelpUrgent: false,
    sessionStartTime: Date.now(),
    questionsAsked: 0,
    ws: null,
    reconnectTimer: null,
    sessionTimerInterval: null,
    chatMessages: [],
    isChatLoading: false,
    // LiveAvatar state
    avatarSession: null,
    avatarRoom: null,
    isAvatarConnected: false,
    isAvatarSpeaking: false,
    avatarSessionToken: null
  };

  // ==================== DOM ELEMENTS ====================
  const elements = {
    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    conceptBadge: document.getElementById('conceptBadge'),

    // Session Info
    sessionTime: document.getElementById('sessionTime'),
    conceptsCount: document.getElementById('conceptsCount'),
    questionsCount: document.getElementById('questionsCount'),

    // Feelings
    feelingButtons: document.querySelectorAll('.feeling-btn'),

    // CTAs
    askQuestionBtn: document.getElementById('askQuestionBtn'),
    needHelpBtn: document.getElementById('needHelpBtn'),

    // Timeline
    timelineEmpty: document.getElementById('timelineEmpty'),
    timelineFeed: document.getElementById('timelineFeed'),

    // Avatar
    avatarStatus: document.getElementById('avatarStatus'),
    avatarExplainBtn: document.getElementById('avatarExplainBtn'),

    // Modals
    questionModal: document.getElementById('questionModal'),
    closeQuestionModal: document.getElementById('closeQuestionModal'),
    questionInput: document.getElementById('questionInput'),
    submitQuestionBtn: document.getElementById('submitQuestionBtn'),
    chatMessages: document.getElementById('chatMessages'),
    chatLoading: document.getElementById('chatLoading'),

    avatarModal: document.getElementById('avatarModal'),
    closeAvatarModal: document.getElementById('closeAvatarModal'),
    avatarExplanationContent: document.getElementById('avatarExplanationContent'),
    conceptSelectModal: document.getElementById('conceptSelectModal'),
    speakBtn: document.getElementById('speakBtn')
  };

  // ==================== WEBSOCKET CONNECTION ====================
  /**
   * Connect to WebSocket server for real-time data
   * In production, this will receive concept cards from backend
   */
  function connectWebSocket() {
    const isHttps = window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/`;

    logger.debug('Connecting to WebSocket:', wsUrl);

    try {
      state.ws = new WebSocket(wsUrl);
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      return;
    }

    state.ws.onopen = () => {
      logger.info('WebSocket connected');
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
    };

    state.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        logger.error('Error parsing message:', error);
      }
    };

    state.ws.onclose = () => {
      logger.info('WebSocket disconnected');
      if (!state.reconnectTimer) {
        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = null;
          connectWebSocket();
        }, 3000);
      }
    };

    state.ws.onerror = (error) => {
      logger.error('WebSocket error:', error);
    };
  }

  /**
   * Handle incoming WebSocket messages
   * @param {Object} message - Message from backend
   */
  function handleWebSocketMessage(message) {
    logger.debug('Received message:', message);

    switch (message.type) {
      case 'concept':
        handleNewConcept(message);
        break;
      case 'meeting_started':
        state.sessionStartTime = Date.now();
        break;
      default:
        logger.debug('Unknown message type:', message.type);
    }
  }

  // ==================== TAB SWITCHING ====================
  /**
   * Switch between tabs
   * @param {string} tabName - Tab to switch to (feelings, timeline, avatar)
   */
  function switchTab(tabName) {
    // Update tab buttons
    elements.tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update tab panels
    elements.tabPanels.forEach(panel => {
      if (panel.id === `${tabName}Tab`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    logger.info('Switched to tab:', tabName);
  }

  /**
   * Update concept badge count
   */
  function updateConceptBadge() {
    const count = state.concepts.length;
    elements.conceptBadge.textContent = count;
  }

  // ==================== SESSION INFO TRACKING ====================
  /**
   * Start session timer
   */
  function startSessionTimer() {
    // Update immediately
    updateSessionTime();

    // Update every second
    state.sessionTimerInterval = setInterval(updateSessionTime, 1000);
  }

  /**
   * Update session time display
   */
  function updateSessionTime() {
    const elapsed = Date.now() - state.sessionStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (elements.sessionTime) {
      elements.sessionTime.textContent = timeString;
    }
  }

  /**
   * Update session info displays
   */
  function updateSessionInfo() {
    // Update concepts count
    if (elements.conceptsCount) {
      elements.conceptsCount.textContent = state.concepts.length;
    }

    // Update questions count
    if (elements.questionsCount) {
      elements.questionsCount.textContent = state.questionsAsked;
    }
  }

  // ==================== FEELINGS TRACKING ====================
  /**
   * Handle feeling button clicks
   * Updates understanding score dynamically
   */
  function handleFeelingClick(event) {
    const button = event.currentTarget;
    const feeling = button.dataset.feeling;

    // Remove active from all
    elements.feelingButtons.forEach(btn => btn.classList.remove('active'));

    // Add active to clicked
    button.classList.add('active');

    // Store feeling
    state.feeling = feeling;

    // Update understanding score
    updateUnderstandingScore(feeling);

    // Broadcast feeling update to instructor UI (via WebSocket and BroadcastChannel)
    try {
      const payload = {
        type: 'feeling_update',
        studentName: localStorage.getItem('ta_student_name') || `Student-${Math.floor(Math.random() * 900) + 100}`,
        feeling,
        score: { lost: 30, kinda: 65, gotit: 95 }[feeling] || null,
        timestamp: Date.now()
      };

      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(payload));
      }

      try {
        const bc = new BroadcastChannel('ta-help-channel');
        bc.postMessage(payload);
        bc.close();
      } catch (e) {
        logger.debug('BroadcastChannel not available for feeling_update:', e);
      }
    } catch (err) {
      logger.debug('Failed to broadcast feeling_update:', err);
    }

    logger.info('Feeling updated:', feeling);
  }

  /**
   * Update understanding score based on feeling
   * @param {string} feeling - lost, kinda, or gotit
   */
  function updateUnderstandingScore(feeling) {
    const scoreMap = {
      lost: 30,
      kinda: 65,
      gotit: 95
    };

    const score = scoreMap[feeling] || 50;
    state.understandingHistory.push({ feeling, score, timestamp: Date.now() });

    // Calculate rolling average (last 5 feelings)
    const recentHistory = state.understandingHistory.slice(-5);
    const avgScore = Math.round(
      recentHistory.reduce((sum, item) => sum + item.score, 0) / recentHistory.length
    );

    // Score tracking for backend use
    logger.info('Understanding score updated:', avgScore);
  }


  // ==================== ASK QUESTION MODAL (CHATBOT) ====================
  const API_CONVERSE = '/api/agent/converse';
  const API_CONCEPT_CARDS = '/api/concept-cards';

  /** Polling interval for concept cards (ms) */
  const CONCEPT_CARDS_POLL_INTERVAL_MS = 5000;

  /**
   * Open the ask question modal
   */
  function openQuestionModal() {
    elements.questionModal.classList.add('active');
    elements.questionInput.value = '';
    elements.questionInput.focus();
    renderChatMessages();
  }

  /**
   * Close the ask question modal
   */
  function closeQuestionModal() {
    elements.questionModal.classList.remove('active');
  }

  /**
   * Format agent response: markdown-like to HTML (bold, paragraphs, lists)
   */
  function formatAgentResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let t = escapeHtml(text);
    const fmt = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const paragraphs = t.split(/\n\n+/);
    const blocks = [];
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const listLines = trimmed.split('\n').filter((l) => /^[\s]*[-*•]\s+/.test(l));
      if (listLines.length > 0 && listLines.length === trimmed.split('\n').length) {
        const items = listLines.map((l) => fmt(l.replace(/^[\s]*[-*•]\s+/, '')));
        blocks.push('<ul><li>' + items.join('</li><li>') + '</li></ul>');
      } else {
        const html = fmt(trimmed).replace(/\n/g, '<br>');
        blocks.push('<p>' + html + '</p>');
      }
    }
    return blocks.join('');
  }

  /**
   * Append a message to the chat UI
   * @param {string} role - 'user' | 'agent' | 'error'
   * @param {string} text - Message text
   */
  function appendChatMessage(role, text) {
    state.chatMessages.push({ role, text, timestamp: Date.now() });
    renderChatMessage(state.chatMessages[state.chatMessages.length - 1]);
  }

  /**
   * Render a single message bubble
   */
  function renderChatMessage(msg) {
    if (!elements.chatMessages) return;
    const div = document.createElement('div');
    div.className = `chat-bubble chat-bubble-${msg.role}`;
    const content = msg.role === 'agent'
      ? formatAgentResponse(msg.text)
      : escapeHtml(msg.text);
    div.innerHTML = `<div class="chat-bubble-inner">${content}</div>`;
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  /**
   * Show loading bubble with animated dots in chat area
   */
  function showChatLoadingBubble() {
    if (!elements.chatMessages) return;
    const div = document.createElement('div');
    div.className = 'chat-bubble chat-bubble-agent chat-bubble-loading';
    div.id = 'chatLoadingBubble';
    div.innerHTML = `
      <div class="chat-bubble-inner">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  /**
   * Remove loading bubble from chat area
   */
  function hideChatLoadingBubble() {
    const el = document.getElementById('chatLoadingBubble');
    if (el) el.remove();
  }

  /**
   * Re-render all chat messages (e.g. when opening modal)
   */
  function renderChatMessages() {
    if (!elements.chatMessages) return;
    elements.chatMessages.innerHTML = '';
    state.chatMessages.forEach(renderChatMessage);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  /**
   * Set loading state for chat submit (button + loading bubble)
   */
  function setChatLoading(loading) {
    state.isChatLoading = loading;
    if (elements.submitQuestionBtn) {
      elements.submitQuestionBtn.disabled = loading;
    }
    if (elements.chatLoading) {
      elements.chatLoading.style.display = loading ? 'flex' : 'none';
    }
    const textSpan = elements.submitQuestionBtn?.querySelector('#submitBtnText');
    if (textSpan) {
      textSpan.style.display = loading ? 'none' : 'inline';
    }
    const arrow = elements.submitQuestionBtn?.querySelector('.btn-arrow');
    if (arrow) {
      arrow.style.display = loading ? 'none' : 'block';
    }
    if (loading) {
      showChatLoadingBubble();
    } else {
      hideChatLoadingBubble();
    }
  }

  /**
   * Extract agent response message from converse API response
   */
  function extractAgentMessage(data) {
    if (data?.response?.message) return String(data.response.message);
    if (data?.message) return String(data.message);
    if (data?.output) return String(data.output);
    if (typeof data === 'string') return data;
    return 'I could not generate a response. Please try again.';
  }

  /**
   * Submit student question (chat)
   */
  async function submitQuestion() {
    const question = elements.questionInput.value.trim();
    if (!question || state.isChatLoading) return;

    elements.questionInput.value = '';
    appendChatMessage('user', question);
    state.questionsAsked++;
    updateSessionInfo();

    setChatLoading(true);

    try {
      const res = await fetch(API_CONVERSE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: question, agent_id: 'tada-agent' }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data?.error || `Backend error (${res.status})`;
        appendChatMessage('error', errMsg + '. Is the TA-DA backend running? Start it with: npm run dev in the backend folder.');
        logger.error('Converse API error:', errMsg);
        return;
      }

      const agentText = extractAgentMessage(data);
      appendChatMessage('agent', agentText);
      logger.info('Agent response received');
    } catch (err) {
      const msg = err?.message || 'Network error';
      appendChatMessage('error', msg + '. Make sure the TA-DA backend is running at http://localhost:3000');
      logger.error('Converse fetch failed:', err);
    } finally {
      setChatLoading(false);
    }
  }

  /**
   * Add student question card to timeline
   * @param {string} question - Question text
   */
  function addStudentQuestionCard(question) {
    hideTimelineEmpty();

    const card = document.createElement('div');
    card.className = 'student-question-card';
    card.innerHTML = `
      <div class="question-label">Student Question</div>
      <div class="question-text">${escapeHtml(question)}</div>
    `;

    elements.timelineFeed.appendChild(card);
  }

  // ==================== NEED HELP ====================
  /**
   * Trigger urgent help request
   */
  function triggerNeedHelp() {
    state.isHelpUrgent = true;
    elements.needHelpBtn.classList.add('urgent');

    logger.info('Help requested');

    // In production, send urgent signal to backend
    // if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    //   state.ws.send(JSON.stringify({ type: 'urgent_help' }));
    // }

    // Send help request to backend via WebSocket (preferred)
    try {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          type: 'help_request',
          studentName: localStorage.getItem('ta_student_name') || 'Student',
          feeling: state.feeling || 'unknown',
          timestamp: Date.now(),
          message: ''
        }));
      }
    } catch (err) {
      logger.debug('WS send failed:', err);
    }

    // Also broadcast help request to any instructor dashboard tabs (demo/hackathon use)
    try {
      if (!localStorage.getItem('ta_student_name')) {
        // seed a demo student name for this tab
        localStorage.setItem('ta_student_name', `Student-${Math.floor(Math.random() * 900) + 100}`);
      }
      const bc = new BroadcastChannel('ta-help-channel');
      bc.postMessage({
        type: 'help_request',
        studentName: localStorage.getItem('ta_student_name'),
        feeling: state.feeling || 'unknown',
        timestamp: Date.now(),
        message: ''
      });
      bc.close();
    } catch (err) {
      logger.debug('BroadcastChannel not available:', err);
    }

    // Auto-remove urgent state after 5 seconds
    setTimeout(() => {
      state.isHelpUrgent = false;
      elements.needHelpBtn.classList.remove('urgent');
    }, 5000);
  }

  // ==================== CONCEPT CARDS ====================
  /**
   * Map API hit from GET /concept-cards to internal concept shape
   * @param {Object} hit - { _id, title, short_explain, example, timestamp, ... }
   */
  function mapHitToConcept(hit) {
    const description = [hit.short_explain, hit.example].filter(Boolean).join(' ');
    return {
      id: hit._id || hit.concept_id || `concept-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: hit.title || 'Untitled Concept',
      description: description || '',
      confidence: hit.confidence != null ? hit.confidence : 85,
      timestamp: hit.timestamp ? new Date(hit.timestamp).getTime() : Date.now(),
      pinned: false,
      resolved: false
    };
  }

  /**
   * Build a single concept card DOM element (no state update)
   * @param {Object} concept - Concept object
   * @returns {HTMLElement} Card element
   */
  function buildConceptCardElement(concept) {
    const card = document.createElement('div');
    card.className = 'concept-card pulse-in';
    card.dataset.conceptId = concept.id;

    const time = new Date(concept.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="concept-header">
        <div class="concept-title-area">
          <h3 class="concept-title">${escapeHtml(concept.title)}</h3>
          <div class="concept-meta">
            <span class="concept-timestamp">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              ${time}
            </span>
            <span class="concept-confidence">
              <span>Confidence:</span>
              <div class="confidence-bar">
                <div class="confidence-fill" style="width: ${concept.confidence}%"></div>
              </div>
              <span>${concept.confidence}%</span>
            </span>
          </div>
        </div>
      </div>
      <p class="concept-description">${escapeHtml(concept.description)}</p>
      <div class="concept-actions">
        <button class="concept-action-btn pin-btn" data-action="pin">
          <span>📌</span>
          <span>Pin</span>
        </button>
        <button class="concept-action-btn avatar-btn" data-action="avatar">
          <span>🎙</span>
          <span>Ask Avatar</span>
        </button>
        <button class="concept-action-btn upvote-btn" data-action="upvote">
          <span>👍</span>
          <span>Upvote</span>
        </button>
        <button class="concept-action-btn resolve-btn" data-action="resolve">
          <span>✓</span>
          <span>Mark Resolved</span>
        </button>
      </div>
    `;

    const actionButtons = card.querySelectorAll('.concept-action-btn');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', () => handleConceptAction(concept.id, btn.dataset.action));
    });
    return card;
  }

  /**
   * Replace the entire timeline with a list of concepts (from API)
   * @param {Array<Object>} concepts - Array of concept objects
   */
  function replaceTimelineWithConcepts(concepts) {
    state.concepts = concepts;
    elements.timelineFeed.innerHTML = '';
    if (concepts.length === 0) {
      showTimelineEmpty();
    } else {
      hideTimelineEmpty();
      concepts.forEach(function (c) {
        elements.timelineFeed.appendChild(buildConceptCardElement(c));
      });
    }
    updateConceptBadge();
    updateConceptSelectOptions();
    updateSessionInfo();
  }

  /**
   * Fetch concept cards from backend and only add new ones (keep existing intact)
   */
  function fetchConceptCards() {
    fetch(API_CONCEPT_CARDS)
      .then(function (r) {
        if (!r.ok) throw new Error('concept-cards ' + r.status);
        return r.json();
      })
      .then(function (data) {
        const hits = data.hits || [];
        const existingIds = {};
        state.concepts.forEach(function (c) { existingIds[c.id] = true; });
        let added = 0;
        hits.forEach(function (hit) {
          const concept = mapHitToConcept(hit);
          if (existingIds[concept.id]) return;
          existingIds[concept.id] = true;
          state.concepts.push(concept);
          hideTimelineEmpty();
          elements.timelineFeed.appendChild(buildConceptCardElement(concept));
          added++;
        });
        if (added > 0) {
          updateConceptBadge();
          updateConceptSelectOptions();
          updateSessionInfo();
          logger.debug('Concept cards: added', added, 'new');
        }
      })
      .catch(function (err) {
        logger.error('Failed to fetch concept cards:', err);
      });
  }

  /**
   * Handle new concept from backend (e.g. WebSocket)
   * @param {Object} data - Concept data
   */
  function handleNewConcept(data) {
    const concept = {
      id: data.id || `concept-${Date.now()}`,
      title: data.title || 'New Concept',
      description: data.description || '',
      confidence: data.confidence != null ? data.confidence : Math.floor(Math.random() * 30) + 70,
      timestamp: data.timestamp || Date.now(),
      pinned: false,
      resolved: false
    };

    state.concepts.push(concept);
    hideTimelineEmpty();
    elements.timelineFeed.appendChild(buildConceptCardElement(concept));
    updateConceptSelectOptions();
    updateConceptBadge();
    updateSessionInfo();
  }

  /**
   * Add concept card to timeline (single card, e.g. from WebSocket)
   * @param {Object} concept - Concept object
   */
  function addConceptCard(concept) {
    state.concepts.push(concept);
    hideTimelineEmpty();
    elements.timelineFeed.appendChild(buildConceptCardElement(concept));
    updateConceptSelectOptions();
    updateConceptBadge();
    updateSessionInfo();
  }

  /**
   * Handle concept card actions
   * @param {string} conceptId - Concept ID
   * @param {string} action - Action type (pin, avatar, upvote, resolve)
   */
  function handleConceptAction(conceptId, action) {
    const concept = state.concepts.find(c => c.id === conceptId);
    if (!concept) return;

    const card = document.querySelector(`[data-concept-id="${conceptId}"]`);
    if (!card) return;

    switch (action) {
      case 'pin':
        concept.pinned = !concept.pinned;
        card.classList.toggle('pinned');
        const pinBtn = card.querySelector('.pin-btn');
        pinBtn.classList.toggle('pinned');

        // Move to top if pinned
        if (concept.pinned) {
          elements.timelineFeed.prepend(card);
        }
        break;

      case 'avatar':
        openAvatarModal(concept);
        break;

      case 'upvote':
        // Visual feedback
        const upvoteBtn = card.querySelector('.upvote-btn');
        upvoteBtn.style.color = 'var(--neon-green)';
        setTimeout(() => {
          upvoteBtn.style.color = '';
        }, 2000);
        break;

      case 'resolve':
        concept.resolved = true;
        card.style.opacity = '0.5';
        card.style.transform = 'scale(0.95)';
        break;
    }

    logger.info(`Concept action: ${action}`, conceptId);
  }

  /**
   * Hide timeline empty state
   */
  function hideTimelineEmpty() {
    if (elements.timelineEmpty) {
      elements.timelineEmpty.style.display = 'none';
    }
  }

  /**
   * Show timeline empty state
   */
  function showTimelineEmpty() {
    if (elements.timelineEmpty) {
      elements.timelineEmpty.style.display = '';
    }
  }

  // ==================== AVATAR MODAL ====================
  /**
   * Open avatar explanation modal
   * @param {Object} concept - Optional concept to explain
   */
  function openAvatarModal(concept = null) {
    elements.avatarModal.classList.add('active');

    // Initialize avatar if not already connected
    if (!state.isAvatarConnected) {
      initializeLiveAvatar();
    }

    if (concept) {
      elements.conceptSelectModal.value = concept.id;
      displayExplanation(concept);
    }
  }

  /**
   * Close avatar explanation modal
   */
  function closeAvatarModal() {
    elements.avatarModal.classList.remove('active');
    // Disconnect avatar when closing modal
    disconnectAvatar();
  }

  /**
   * Display explanation for selected concept
   * @param {Object} concept - Concept to explain
   */
  function displayExplanation(concept) {
    // In production, this would call AI backend for explanation
    const explanation = `
      <h3 style="margin-bottom: 12px; color: var(--neon-cyan);">${escapeHtml(concept.title)}</h3>
      <p class="explanation-text">
        Let me break this down for you. ${escapeHtml(concept.description)}
        <br><br>
        Think of it this way: This concept is fundamental because it helps you understand
        the relationship between different components in the system. When you grasp this,
        you'll be able to connect the dots with what comes next in the lecture.
        <br><br>
        <strong style="color: var(--neon-green);">Key Takeaway:</strong> Focus on understanding
        the core principles rather than memorizing details. The details will make sense once
        you have the foundation.
      </p>
    `;

    elements.avatarExplanationContent.innerHTML = explanation;
  }

  /**
   * Update concept select options
   */
  function updateConceptSelectOptions() {
    // Clear existing options except first
    const firstOption = elements.conceptSelectModal.querySelector('option');
    elements.conceptSelectModal.innerHTML = '';
    elements.conceptSelectModal.appendChild(firstOption);

    // Add all concepts
    state.concepts.forEach(concept => {
      const option = document.createElement('option');
      option.value = concept.id;
      option.textContent = concept.title;
      elements.conceptSelectModal.appendChild(option);
    });
  }

  /**
   * Handle concept select change
   */
  function handleConceptSelect() {
    const conceptId = elements.conceptSelectModal.value;
    if (!conceptId) return;

    const concept = state.concepts.find(c => c.id === conceptId);
    if (concept) {
      displayExplanation(concept);
    }
  }

  /**
   * Speak explanation using Web Speech API
   */
  function speakExplanation() {
    if (!('speechSynthesis' in window)) {
      alert('Sorry, your browser does not support text-to-speech.');
      return;
    }

    const text = elements.avatarExplanationContent.textContent;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    window.speechSynthesis.speak(utterance);

    logger.info('Speaking explanation');
  }

  // ==================== LIVEAVATAR INTEGRATION ====================
  /**
   * Update avatar status display
   * @param {string} message - Status message
   * @param {string} type - Status type (default, connecting, connected, speaking, error)
   */
  function updateAvatarStatus(message, type = 'default') {
    const statusEl = document.getElementById('avatarStatus');
    if (!statusEl) return;
    
    statusEl.textContent = message;
    statusEl.className = `avatar-status-text avatar-status-${type}`;
    
    // Add color styling based on type
    const colorMap = {
      'default': '#00f5ff',
      'connecting': '#ff8500',
      'connected': '#06ffa5',
      'speaking': '#ff006e',
      'error': '#ff0000'
    };
    statusEl.style.color = colorMap[type] || '#00f5ff';
  }

  /**
   * Initialize LiveAvatar session
   */
  async function initializeLiveAvatar() {
    try {
      updateAvatarStatus('Initializing avatar session...', 'connecting');
      const speakBtn = elements.speakBtn;
      if (speakBtn) speakBtn.disabled = true;

      // Step 1: Get session token from backend
      logger.info('Requesting LiveAvatar token from backend');
      const tokenResponse = await fetch('/api/liveavatar/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to get session token (${tokenResponse.status})`);
      }

      const tokenData = await tokenResponse.json();
      state.avatarSessionToken = tokenData.session_token;
      logger.info('Session token received');

      // Step 2: Start LiveAvatar session (via proxy to avoid CSP issues)
      updateAvatarStatus('Starting avatar session...', 'connecting');
      logger.info('Starting LiveAvatar session');
      
      const startResponse = await fetch(
        '/api/liveavatar/session/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            session_token: state.avatarSessionToken
          })
        }
      );

      if (!startResponse.ok) {
        throw new Error('Failed to start LiveAvatar session');
      }

      const sessionData = await startResponse.json();
      state.avatarSession = sessionData.data;
      logger.info('Avatar session started:', state.avatarSession);

      // Step 3: Connect to LiveKit
      updateAvatarStatus('Connecting to video stream...', 'connecting');
      logger.info('Connecting to LiveKit');
      
      await connectAvatarToLiveKit();

      updateAvatarStatus('✅ Avatar ready!', 'connected');
      if (speakBtn) speakBtn.disabled = false;
      state.isAvatarConnected = true;
      
    } catch (error) {
      logger.error('LiveAvatar initialization error:', error);
      updateAvatarStatus(`Error: ${error.message}`, 'error');
      const speakBtn = elements.speakBtn;
      if (speakBtn) speakBtn.disabled = true;
    }
  }

  /**
   * Connect to LiveKit for avatar video streaming
   */
  async function connectAvatarToLiveKit() {
    // Wait for LiveKit library to load
    await waitForLiveKit();
    
    // Get the correct reference (could be LiveKit or LivekitClient depending on version)
    const LK = window.LiveKit || window.LivekitClient;
    
    if (!LK) {
      throw new Error('LiveKit library not available');
    }

    if (!state.avatarSession) {
      throw new Error('Avatar session not initialized');
    }

    // Get LiveKit connection details from session
    const roomUrl = 
      state.avatarSession.livekit_url || 
      state.avatarSession.url || 
      state.avatarSession.room_url;
      
    const roomToken = 
      state.avatarSession.livekit_token ||
      state.avatarSession.token ||
      state.avatarSession.room_token ||
      state.avatarSession.livekit_client_token;

    if (!roomUrl || !roomToken) {
      throw new Error('Missing LiveKit connection details from session');
    }

    // Create and connect LiveKit Room
    state.avatarRoom = new LK.Room();

    // Handle video track subscription
    state.avatarRoom.on(
      LK.RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        logger.info('Track subscribed:', track.kind);
        
        if (track.kind === 'video') {
          const videoElement = document.getElementById('avatar-video');
          if (videoElement) {
            track.attach(videoElement);
            logger.info('Video track attached to element');
          }
        }

        if (track.kind === 'audio') {
          const audioElement = document.createElement('audio');
          audioElement.autoplay = true;
          document.body.appendChild(audioElement);
          track.attach(audioElement);
          logger.info('Audio track created and attached');
        }
      }
    );

    // Handle disconnection
    state.avatarRoom.on(LK.RoomEvent.Disconnected, () => {
      logger.info('Disconnected from avatar room');
      state.isAvatarConnected = false;
      updateAvatarStatus('Disconnected from avatar', 'error');
    });

    // Handle data messages from server
    state.avatarRoom.on(
      LK.RoomEvent.DataReceived,
      (payload, participant, kind, topic) => {
        if (topic === 'agent-response') {
          try {
            const decoder = new TextDecoder();
            const eventData = JSON.parse(decoder.decode(payload));
            logger.info('Avatar event received:', eventData);

            switch (eventData.event_type) {
              case 'avatar.speak_started':
                updateAvatarStatus('🎤 Avatar is speaking...', 'speaking');
                state.isAvatarSpeaking = true;
                break;
              case 'avatar.speak_ended':
                updateAvatarStatus('✅ Done speaking', 'connected');
                state.isAvatarSpeaking = false;
                const speakBtn = elements.speakBtn;
                if (speakBtn) {
                  speakBtn.disabled = false;
                  const speakText = speakBtn.querySelector('#speakBtnText');
                  if (speakText) speakText.style.display = 'inline';
                  const speakLoading = speakBtn.querySelector('#speakLoading');
                  if (speakLoading) speakLoading.style.display = 'none';
                }
                break;
              case 'avatar.transcription':
                logger.info('Avatar transcription:', eventData.text);
                break;
            }
          } catch (err) {
            logger.error('Error parsing avatar event:', err);
          }
        }
      }
    );

    // Connect to the room
    logger.info('Connecting to LiveKit room:', roomUrl);
    await state.avatarRoom.connect(roomUrl, roomToken);
    logger.info('Successfully connected to LiveKit');
  }

  /**
   * Send text to avatar to speak
   * @param {string} text - Text to speak
   */
  async function sendTextToAvatar(text) {
    if (!state.isAvatarConnected || !state.avatarRoom || !state.avatarSession) {
      logger.error('Avatar not connected');
      updateAvatarStatus('Avatar not connected. Please initialize first.', 'error');
      return;
    }

    if (state.isAvatarSpeaking) {
      logger.warn('Avatar is already speaking');
      return;
    }

    try {
      state.isAvatarSpeaking = true;
      updateAvatarStatus('🎤 Avatar is speaking...', 'speaking');
      
      const speakBtn = elements.speakBtn;
      if (speakBtn) {
        speakBtn.disabled = true;
        const speakText = speakBtn.querySelector('#speakBtnText');
        if (speakText) speakText.style.display = 'none';
        const speakLoading = speakBtn.querySelector('#speakLoading');
        if (speakLoading) speakLoading.style.display = 'inline-flex';
      }

      // Create speak event
      const event = {
        event_type: 'avatar.speak_text',
        session_id: state.avatarSession.session_id,
        text: text
      };

      // Send via LiveKit data channel
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(event));

      await state.avatarRoom.localParticipant.publishData(data, {
        reliable: true,
        topic: 'agent-control'
      });

      logger.info('Sent speak event to avatar');

      // Fallback timeout in case server event doesn't arrive
      const estimatedDuration = Math.max(3000, text.length * 40);
      setTimeout(() => {
        if (state.isAvatarSpeaking) {
          logger.warn('Avatar speaking timeout - resetting state');
          state.isAvatarSpeaking = false;
          updateAvatarStatus('✅ Done speaking', 'connected');
          const btn = elements.speakBtn;
          if (btn) {
            btn.disabled = false;
            const btnText = btn.querySelector('#speakBtnText');
            if (btnText) btnText.style.display = 'inline';
            const loading = btn.querySelector('#speakLoading');
            if (loading) loading.style.display = 'none';
          }
        }
      }, estimatedDuration);
      
    } catch (error) {
      logger.error('Error sending text to avatar:', error);
      updateAvatarStatus(`Error: ${error.message}`, 'error');
      state.isAvatarSpeaking = false;
      const speakBtn = elements.speakBtn;
      if (speakBtn) {
        speakBtn.disabled = false;
        const speakText = speakBtn.querySelector('#speakBtnText');
        if (speakText) speakText.style.display = 'inline';
        const speakLoading = speakBtn.querySelector('#speakLoading');
        if (speakLoading) speakLoading.style.display = 'none';
      }
    }
  }

  /**
   * Disconnect from avatar
   */
  async function disconnectAvatar() {
    if (state.avatarRoom) {
      await state.avatarRoom.disconnect();
      state.avatarRoom = null;
      state.isAvatarConnected = false;
      state.isAvatarSpeaking = false;
      logger.info('Avatar disconnected');
    }
  }

  /**
   * Wait for LiveKit client library to load
   */
  function waitForLiveKit() {
    return new Promise((resolve, reject) => {
      if (typeof window.LiveKit !== 'undefined' || typeof window.LivekitClient !== 'undefined') {
        logger.info('LiveKit library already loaded');
        resolve();
        return;
      }
      
      let attempts = 0;
      const maxAttempts = 100; // 10 seconds max
      const checkInterval = setInterval(() => {
        attempts++;
        logger.debug(`Waiting for LiveKit library... attempt ${attempts}/${maxAttempts}`);
        
        if (typeof window.LiveKit !== 'undefined' || typeof window.LivekitClient !== 'undefined') {
          clearInterval(checkInterval);
          logger.info('LiveKit library loaded successfully');
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          logger.error('LiveKit library failed to load after 10 seconds');
          reject(new Error('LiveKit library failed to load from CDN. Check your internet connection or browser console for errors.'));
        }
      }, 100);
    });
  }

  // ==================== REAL-TIME SIMULATION ====================
  /**
   * Simulate real-time data stream for demo
   * In production, this would be replaced by actual WebSocket data
   */
  function startRealtimeSimulation() {
    const sampleConcepts = [
      {
        title: 'Bayes\' Theorem',
        description: 'A mathematical formula for determining conditional probability. It describes the probability of an event based on prior knowledge of conditions related to the event.',
        confidence: 87,
        avatarExplanation: 'Hello! Let me explain Bayes\' Theorem. This is a fundamental concept in probability and machine learning. Bayes\' Theorem helps us update our beliefs based on new evidence. In simple terms, it tells us how to calculate the probability of something happening given that we already know something else happened. For example, if I know it rained yesterday, what\'s the probability it will rain today? Bayes\' Theorem helps us answer questions like this by combining what we know before with what we observe now. This is incredibly powerful in machine learning because it allows us to make smarter predictions. Remember, the key insight is that we\'re updating our original belief with new information. That\'s what makes it so useful in real-world applications!'
      },
      {
        title: 'Machine Learning Pipeline',
        description: 'A sequence of data processing steps that automates the workflow of a predictive model. It includes data preprocessing, feature engineering, model training, and evaluation.',
        confidence: 92,
        avatarExplanation: 'Great question about the Machine Learning Pipeline! Think of it like an assembly line in a factory. Data comes in one end and predictions come out the other. The pipeline has several stages. First, we clean the data and prepare it. We call this preprocessing. Next, we engineer features, which means we create useful variables from our raw data. Then we train our model using this prepared data. Finally, we evaluate how well it works. The beauty of a pipeline is that it\'s automated and repeatable. When new data comes in, it goes through all these steps automatically. This ensures consistency and makes our work much more efficient. In production systems, pipelines run continuously, updating models and making predictions without human intervention.'
      },
      {
        title: 'Gradient Descent',
        description: 'An optimization algorithm used to minimize the cost function in machine learning. It iteratively adjusts parameters to find the minimum value.',
        confidence: 78,
        avatarExplanation: 'Let me walk you through Gradient Descent. Imagine you\'re standing on a hill in the fog, and you want to get to the valley. You can\'t see the whole landscape, so you look at the ground around you and take a step downhill. Then you repeat. That\'s essentially what gradient descent does! In machine learning, instead of a physical hill, we have a cost function. This function measures how wrong our model is. Gradient descent calculates the slope at our current position and takes a step in the direction that reduces the cost. We repeat this process many times until we reach a minimum, which means our model makes the fewest mistakes. The size of each step we take is called the learning rate. If it\'s too small, we move very slowly. If it\'s too large, we might overshoot and miss the valley. Understanding this concept is crucial because gradient descent is used to train most machine learning models today!'
      },
      {
        title: 'Overfitting vs Underfitting',
        description: 'Overfitting occurs when a model learns training data too well, including noise. Underfitting happens when a model is too simple to capture the underlying pattern.',
        confidence: 85,
        avatarExplanation: 'This is one of the most important concepts in machine learning, so pay attention! Imagine you\'re learning to identify cats from pictures. Overfitting is like memorizing every single cat photo you see, including every little detail that\'s unique to those specific photos. When you see a new cat you\'ve never seen before, you fail because you memorized the details rather than learning what makes a cat a cat. Underfitting is the opposite problem. It\'s like someone told you cats are round and that\'s all you remember. You miss the ears, the whiskers, all the important features. So you end up misclassifying many things. The goal is to find the sweet spot in the middle. We want our model to learn the essential patterns without memorizing noise. This balance between overfitting and underfitting is key to building models that work well on new, unseen data!'
      },
      {
        title: 'Feature Engineering',
        description: 'The process of selecting, creating, and transforming variables to improve model performance. It involves domain knowledge and creativity.',
        confidence: 90,
        avatarExplanation: 'Feature Engineering is where the magic happens in machine learning! You see, raw data is often not very useful for models. We need to transform it into meaningful features that help our model learn better. Let me give you an example. If you want to predict house prices, you might have the date the house was built. But the year itself might not be very useful. Instead, you could create a feature for the age of the house. That\'s more meaningful for predictions! Feature engineering requires both technical skills and domain knowledge. You need to understand your data and your problem deeply. Sometimes a single clever feature can dramatically improve your model\'s performance. In fact, many machine learning competitions are won not by using fancy algorithms, but by creating better features. So remember, garbage in means garbage out. Invest time in feature engineering, and your models will thank you!'
      },
      {
        title: 'Cross-Validation',
        description: 'A technique to assess model performance by splitting data into training and validation sets multiple times. It helps ensure the model generalizes well.',
        confidence: 83,
        avatarExplanation: 'Let me explain Cross-Validation, a technique that every data scientist should master. Imagine you\'re studying for an exam. You read a textbook and then take a practice test from that same textbook. You might feel confident, but when you take a test from a different source, you might do poorly. That\'s the problem we\'re trying to avoid with cross-validation. Cross-validation works like this: we split our data into multiple chunks. Then we train on some chunks and test on the remaining chunks. We do this several times, rotating which chunks we use for testing. This way, every piece of data gets used for both training and testing. The benefit is that we get a more reliable estimate of how well our model will perform on brand new data it\'s never seen before. The most common approach is k-fold cross-validation, where k is typically 5 or 10. This technique is essential for building models that truly generalize well!'
      }
    ];

    let conceptIndex = 0;

    // Add concepts every 8-12 seconds
    function addRandomConcept() {
      if (conceptIndex < sampleConcepts.length) {
        const concept = {
          ...sampleConcepts[conceptIndex],
          id: `demo-concept-${conceptIndex}`,
          timestamp: Date.now()
        };

        handleNewConcept(concept);
        conceptIndex++;
      }

      // Schedule next concept
      const delay = Math.random() * 4000 + 8000; // 8-12 seconds
      setTimeout(addRandomConcept, delay);
    }

    // Start simulation with initial delay
    setTimeout(addRandomConcept, 2000);

    logger.info('Real-time simulation started');
  }

  // ==================== UTILITIES ====================
  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ==================== EVENT LISTENERS ====================
  /**
   * Initialize all event listeners
   */
  function initializeEventListeners() {
    // Tab buttons
    elements.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) {
          switchTab(tab);
        }
      });
    });

    // Feeling buttons
    elements.feelingButtons.forEach(btn => {
      btn.addEventListener('click', handleFeelingClick);
    });

    // Ask Question
    elements.askQuestionBtn.addEventListener('click', openQuestionModal);
    elements.closeQuestionModal.addEventListener('click', closeQuestionModal);
    elements.submitQuestionBtn.addEventListener('click', submitQuestion);

    // Enter to send, Shift+Enter for newline
    elements.questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });

    // Need Help
    elements.needHelpBtn.addEventListener('click', triggerNeedHelp);

    // Avatar
    elements.avatarExplainBtn.addEventListener('click', () => openAvatarModal());
    elements.closeAvatarModal.addEventListener('click', closeAvatarModal);
    elements.conceptSelectModal.addEventListener('change', handleConceptSelect);
    elements.speakBtn.addEventListener('click', () => {
      // Get selected concept
      const conceptId = elements.conceptSelectModal.value;
      if (!conceptId) {
        alert('Please select a concept first');
        return;
      }

      // Find the concept
      const concept = state.concepts.find(c => c.id === conceptId);
      if (!concept) {
        alert('Concept not found');
        return;
      }

      // Get the avatar explanation or fall back to description
      const textToSpeak = concept.avatarExplanation || concept.description;

      // Send to avatar
      if (state.isAvatarConnected) {
        sendTextToAvatar(textToSpeak);
      } else {
        alert('Avatar is not connected. Please wait for initialization.');
      }
    });

    // Close modals on outside click
    elements.questionModal.addEventListener('click', (e) => {
      if (e.target === elements.questionModal) {
        closeQuestionModal();
      }
    });

    elements.avatarModal.addEventListener('click', (e) => {
      if (e.target === elements.avatarModal) {
        closeAvatarModal();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape key closes modals
      if (e.key === 'Escape') {
        closeQuestionModal();
        closeAvatarModal();
      }

      // Ctrl/Cmd + K opens ask question
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openQuestionModal();
      }
    });

    logger.info('Event listeners initialized');
  }

  // ==================== INITIALIZATION ====================
  /**
   * Initialize the application
   */
  function initialize() {
    logger.info('Initializing Live TA Dashboard');

    // Start session timer
    startSessionTimer();

    // Initialize session info
    updateSessionInfo();

    // Connect to WebSocket
    connectWebSocket();

    // Initialize event listeners
    initializeEventListeners();

    // Ensure each student tab has a persistent demo name for instructor tracking
    try {
      if (!localStorage.getItem('ta_student_name')) {
        localStorage.setItem('ta_student_name', `Student-${Math.floor(Math.random() * 900) + 100}`);
      }
    } catch (e) {
      logger.debug('localStorage unavailable for ta_student_name:', e);
    }

    // Load concept cards from ta-da-concept-cards (backend API) on first load and every 5s
    fetchConceptCards();
    setInterval(fetchConceptCards, CONCEPT_CARDS_POLL_INTERVAL_MS);

    // Listen for instructor acknowledgements via BroadcastChannel (demo)
    try {
      const bc = new BroadcastChannel('ta-help-channel');
      bc.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'help_ack') {
          handleHelpAck(msg);
        }
      };
    } catch (e) {
      logger.debug('BroadcastChannel not available for ACKs:', e);
    }

    logger.info('Dashboard initialized successfully');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  /**
   * Handle incoming help acknowledgement targeted at this student
   */
  function handleHelpAck(msg) {
    try {
      const myName = localStorage.getItem('ta_student_name');
      if (!myName) return;
      if (msg.studentName && msg.studentName !== myName) return;

      // Visual feedback: small banner and change needHelp button state briefly
      const banner = document.createElement('div');
      banner.className = 'ack-banner';
      banner.style.position = 'fixed';
      banner.style.bottom = '18px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.background = 'linear-gradient(90deg,#0f172a,#06202b)';
      banner.style.color = '#fff';
      banner.style.padding = '10px 14px';
      banner.style.borderRadius = '10px';
      banner.style.boxShadow = '0 6px 18px rgba(0,0,0,0.4)';
      banner.style.zIndex = '2000';
      banner.textContent = msg.ackBy ? `${msg.ackBy} acknowledged your help request` : 'Instructor acknowledged your help request';
      document.body.appendChild(banner);

      // Temporarily style the Need Help button
      if (elements.needHelpBtn) {
        elements.needHelpBtn.classList.add('acknowledged');
        const prevLabel = elements.needHelpBtn.querySelector('.action-content h4');
        if (prevLabel) prevLabel.dataset._orig = prevLabel.textContent;
        if (prevLabel) prevLabel.textContent = 'Acknowledged';
      }

      setTimeout(() => {
        banner.remove();
        if (elements.needHelpBtn) {
          elements.needHelpBtn.classList.remove('acknowledged');
          const prevLabel = elements.needHelpBtn.querySelector('.action-content h4');
          if (prevLabel && prevLabel.dataset._orig) prevLabel.textContent = prevLabel.dataset._orig;
        }
      }, 4500);
    } catch (err) {
      logger.debug('handleHelpAck error:', err);
    }
  }

  // ==================== PUBLIC API ====================
  /**
   * Expose API for external integration
   * Backend can call these methods to update UI
   */
  window.LiveTA = {
    addConcept: handleNewConcept,
    addQuestion: addStudentQuestionCard,
    getState: () => ({ ...state }),
    openAvatarExplanation: openAvatarModal
  };

})();
