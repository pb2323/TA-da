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
    sessionStartTime: null,
    ws: null,
    reconnectTimer: null
  };

  // ==================== DOM ELEMENTS ====================
  const elements = {
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


  // ==================== ASK QUESTION MODAL ====================
  /**
   * Open the ask question modal
   */
  function openQuestionModal() {
    elements.questionModal.classList.add('active');
    elements.questionInput.value = '';
    elements.questionInput.focus();
  }

  /**
   * Close the ask question modal
   */
  function closeQuestionModal() {
    elements.questionModal.classList.remove('active');
  }

  /**
   * Submit student question
   */
  function submitQuestion() {
    const question = elements.questionInput.value.trim();

    if (!question) {
      return;
    }

    // Add question to timeline
    addStudentQuestionCard(question);

    // Close modal
    closeQuestionModal();

    logger.info('Question submitted:', question);

    // In production, send to backend via WebSocket
    // if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    //   state.ws.send(JSON.stringify({ type: 'question', text: question }));
    // }
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

    // Auto-remove urgent state after 5 seconds
    setTimeout(() => {
      state.isHelpUrgent = false;
      elements.needHelpBtn.classList.remove('urgent');
    }, 5000);
  }

  // ==================== CONCEPT CARDS ====================
  /**
   * Handle new concept from backend
   * @param {Object} data - Concept data
   */
  function handleNewConcept(data) {
    const concept = {
      id: data.id || `concept-${Date.now()}`,
      title: data.title || 'New Concept',
      description: data.description || '',
      confidence: data.confidence || Math.floor(Math.random() * 30) + 70,
      timestamp: data.timestamp || Date.now(),
      pinned: false,
      resolved: false
    };

    state.concepts.push(concept);
    addConceptCard(concept);
    updateConceptSelectOptions();
  }

  /**
   * Add concept card to timeline
   * @param {Object} concept - Concept object
   */
  function addConceptCard(concept) {
    hideTimelineEmpty();

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

    elements.timelineFeed.appendChild(card);

    // Add event listeners to action buttons
    const actionButtons = card.querySelectorAll('.concept-action-btn');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', () => handleConceptAction(concept.id, btn.dataset.action));
    });
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

  // ==================== AVATAR MODAL ====================
  /**
   * Open avatar explanation modal
   * @param {Object} concept - Optional concept to explain
   */
  function openAvatarModal(concept = null) {
    elements.avatarModal.classList.add('active');

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
        confidence: 87
      },
      {
        title: 'Machine Learning Pipeline',
        description: 'A sequence of data processing steps that automates the workflow of a predictive model. It includes data preprocessing, feature engineering, model training, and evaluation.',
        confidence: 92
      },
      {
        title: 'Gradient Descent',
        description: 'An optimization algorithm used to minimize the cost function in machine learning. It iteratively adjusts parameters to find the minimum value.',
        confidence: 78
      },
      {
        title: 'Overfitting vs Underfitting',
        description: 'Overfitting occurs when a model learns training data too well, including noise. Underfitting happens when a model is too simple to capture the underlying pattern.',
        confidence: 85
      },
      {
        title: 'Feature Engineering',
        description: 'The process of selecting, creating, and transforming variables to improve model performance. It involves domain knowledge and creativity.',
        confidence: 90
      },
      {
        title: 'Cross-Validation',
        description: 'A technique to assess model performance by splitting data into training and validation sets multiple times. It helps ensure the model generalizes well.',
        confidence: 83
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
    // Feeling buttons
    elements.feelingButtons.forEach(btn => {
      btn.addEventListener('click', handleFeelingClick);
    });

    // Ask Question
    elements.askQuestionBtn.addEventListener('click', openQuestionModal);
    elements.closeQuestionModal.addEventListener('click', closeQuestionModal);
    elements.submitQuestionBtn.addEventListener('click', submitQuestion);

    // Enter key in question input
    elements.questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        submitQuestion();
      }
    });

    // Need Help
    elements.needHelpBtn.addEventListener('click', triggerNeedHelp);

    // Avatar
    elements.avatarExplainBtn.addEventListener('click', () => openAvatarModal());
    elements.closeAvatarModal.addEventListener('click', closeAvatarModal);
    elements.conceptSelectModal.addEventListener('change', handleConceptSelect);
    elements.speakBtn.addEventListener('click', speakExplanation);

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

    // Connect to WebSocket
    connectWebSocket();

    // Initialize event listeners
    initializeEventListeners();

    // Start real-time simulation for demo
    // Comment this out when connecting to real backend
    startRealtimeSimulation();

    logger.info('Dashboard initialized successfully');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
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
