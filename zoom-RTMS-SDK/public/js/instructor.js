(() => {
  'use strict';

  const requestsList = document.getElementById('requestsList');
  const activeCountEl = document.getElementById('activeCount');
  const lostCountEl = document.getElementById('lostCount');
  const kindaCountEl = document.getElementById('kindaCount');
  const gotitCountEl = document.getElementById('gotitCount');
  const recentTimeline = document.getElementById('recentTimeline');

  const state = {
    requests: [],
    stats: { lost: 0, kinda: 0, gotit: 0 },
    prevStats: { lost: 0, kinda: 0, gotit: 0 }
  };

  // Track unique students seen (from feeling updates or requests)
  state.seenStudents = new Set();
  state.lastRepeatSuggestionAt = 0; // timestamp to avoid spamming suggestions

  // Small beep via WebAudio for alerts
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 180);
    } catch (e) {
      // ignore audio errors
    }
  }

  function renderRequests() {
    requestsList.innerHTML = '';
    if (state.requests.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'timeline-empty';
      empty.innerHTML = `
        <div class="empty-animation">
          <svg class="empty-icon" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="30" class="circle-orbit"/>
            <circle cx="50" cy="50" r="20" class="circle-core"/>
          </svg>
        </div>
        <h4 style="font-size:18px;font-weight:600;margin:16px 0 8px 0;">No active requests</h4>
        <p style="color:var(--muted);font-size:14px;margin:0;">Waiting for students to request help...</p>
      `;
      requestsList.appendChild(empty);
      activeCountEl.textContent = '0';
      return;
    }

    state.requests.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'student-question-card';
      card.dataset.id = r.id;

      const time = new Date(r.timestamp).toLocaleTimeString();

      // Feeling emoji and color mapping
      const feelingMap = {
        'lost': { emoji: '😵‍💫', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', label: 'totally lost' },
        'kinda': { emoji: '🤔', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', label: 'kinda vibing' },
        'gotit': { emoji: '✨', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', label: 'totally got it' }
      };
      const feeling = feelingMap[r.feeling] || feelingMap['kinda'];

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;">
          <div style="width:48px;height:48px;background:${feeling.bg};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;border:2px solid ${feeling.color}33;">
            ${feeling.emoji}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <strong style="font-size:16px;font-weight:700;">${escapeHtml(r.studentName)}</strong>
              <span style="font-size:12px;color:var(--muted);font-weight:500;">${time}</span>
            </div>
            <div style="display:inline-block;padding:4px 12px;background:${feeling.bg};border-radius:8px;font-size:12px;font-weight:600;color:${feeling.color};border:1px solid ${feeling.color}33;">
              ${feeling.label}
            </div>
          </div>
        </div>
        ${r.message ? `<div style="margin-bottom:16px;padding:12px;background:rgba(255,255,255,0.03);border-radius:12px;font-size:14px;line-height:1.6;border-left:3px solid ${feeling.color};">${escapeHtml(r.message)}</div>` : ''}
        <div style="display:flex;gap:10px;margin-bottom:12px;">
          <button class="ack-btn" style="flex:1;padding:10px;border-radius:10px;border:2px solid #667eea;background:rgba(102, 126, 234, 0.1);color:#667eea;font-weight:600;font-size:14px;cursor:pointer;transition:all 0.3s ease;">
            ✓ Acknowledge
          </button>
          <button class="resolve-btn" style="flex:1;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);color:white;font-weight:600;font-size:14px;cursor:pointer;transition:all 0.3s ease;box-shadow:0 4px 15px rgba(102, 126, 234, 0.3);">
            ✓ Resolve
          </button>
        </div>
        <div class="ack-info" style="font-size:12px;color:var(--muted);font-weight:500;padding:8px;background:rgba(34, 197, 94, 0.1);border-radius:8px;border-left:3px solid #22c55e;display:none;"></div>
      `;

      const ackBtn = card.querySelector('.ack-btn');
      const resBtn = card.querySelector('.resolve-btn');

      ackBtn.addEventListener('click', () => acknowledgeRequest(r.id));
      resBtn.addEventListener('click', () => resolveRequest(r.id));

      // If already acknowledged, render ack info
      if (r.acknowledged) {
        const info = card.querySelector('.ack-info');
        if (info) {
          const t = new Date(r.ackAt).toLocaleTimeString();
          info.textContent = `✓ Acknowledged by ${r.ackBy} at ${t}`;
          info.style.display = 'block';
          ackBtn.disabled = true;
          ackBtn.style.opacity = '0.5';
          ackBtn.style.cursor = 'not-allowed';
        }
      }

      requestsList.appendChild(card);
    });

    activeCountEl.textContent = String(state.requests.length);
  }

  function addRequest(payload) {
    const id = `req-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const req = {
      id,
      studentName: payload.studentName || 'Student',
      feeling: payload.feeling || 'unknown',
      timestamp: payload.timestamp || Date.now(),
      message: payload.message || '',
      acknowledged: false,
      ackBy: null,
      ackAt: null
    };

    state.requests.unshift(req);

    // add student to seen set
    if (req.studentName) state.seenStudents.add(req.studentName);

    // update stats
    if (req.feeling === 'lost') state.stats.lost++;
    if (req.feeling === 'kinda') state.stats.kinda++;
    if (req.feeling === 'gotit') state.stats.gotit++;

    renderStats();
    renderRequests();
    prependRecentTimeline(req);
    beep();

    checkRepeatSuggestion();
  }

  function acknowledgeRequest(id) {
    const idx = state.requests.findIndex(r => r.id === id);
    if (idx === -1) return;
    const req = state.requests[idx];
    const instructorName = localStorage.getItem('ta_instructor_name') || 'Instructor';
    req.acknowledged = true;
    req.ackBy = instructorName;
    req.ackAt = Date.now();
    renderRequests();

    // Broadcast acknowledgement so student tabs or other instructor tabs can react
    try {
      const bc = new BroadcastChannel('ta-help-channel');
      bc.postMessage({ type: 'help_ack', id: req.id, studentName: req.studentName, ackBy: req.ackBy, ackAt: req.ackAt });
      bc.close();
    } catch (e) {
      console.debug('Broadcast ack failed:', e);
    }
  }

  function resolveRequest(id) {
    const idx = state.requests.findIndex(r => r.id === id);
    if (idx === -1) return;
    state.requests.splice(idx, 1);
    renderRequests();
  }

  function renderStats() {
    // Animate when counts increase
    try {
      if (state.stats.lost !== state.prevStats.lost) {
        lostCountEl.classList.add('update-flash');
        setTimeout(() => lostCountEl.classList.remove('update-flash'), 900);
      }
      if (state.stats.kinda !== state.prevStats.kinda) {
        kindaCountEl.classList.add('update-flash');
        setTimeout(() => kindaCountEl.classList.remove('update-flash'), 900);
      }
      if (state.stats.gotit !== state.prevStats.gotit) {
        gotitCountEl.classList.add('update-flash');
        setTimeout(() => gotitCountEl.classList.remove('update-flash'), 900);
      }
    } catch (e) {
      // ignore animation errors
    }

    lostCountEl.textContent = String(state.stats.lost);
    kindaCountEl.textContent = String(state.stats.kinda);
    gotitCountEl.textContent = String(state.stats.gotit);

    // store previous
    state.prevStats.lost = state.stats.lost;
    state.prevStats.kinda = state.stats.kinda;
    state.prevStats.gotit = state.stats.gotit;
  }

  function checkRepeatSuggestion() {
    try {
      const totalStudents = state.seenStudents.size || 0;
      if (totalStudents < 2) return; // need at least 2 to consider majority

      const threshold = Math.floor(totalStudents / 2) + 1; // more than half
      if (state.stats.lost >= threshold) {
        const now = Date.now();
        // only suggest once per minute
        if (now - state.lastRepeatSuggestionAt > 60_000) {
          state.lastRepeatSuggestionAt = now;
          showRepeatModal(totalStudents, state.stats.lost);
        }
      }
    } catch (e) {
      console.debug('checkRepeatSuggestion error:', e);
    }
  }

  function showRepeatModal(total, lostCount) {
    // simple modal overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '3000';

    const box = document.createElement('div');
    box.className = 'glass-panel';
    box.style.maxWidth = '520px';
    box.style.width = '90%';
    box.style.padding = '24px';

    box.innerHTML = `
      <h3 style="margin-bottom:8px">Many students are lost</h3>
      <p style="color:var(--text-secondary);margin-bottom:16px">${lostCount} of ${total} students reported "totally lost" — consider repeating the current topic.</p>
      <div style="display:flex;gap:12px;justify-content:flex-end">
        <button id="repeatDismiss" style="padding:8px 12px;border-radius:10px;background:transparent;border:1px solid rgba(255,255,255,0.08);color:var(--text-primary)">Dismiss</button>
        <button id="repeatNow" style="padding:8px 12px;border-radius:10px;background:linear-gradient(90deg,var(--neon-cyan),var(--neon-pink));color:#051225;font-weight:700">Repeat Now</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('repeatDismiss').addEventListener('click', () => overlay.remove());
    document.getElementById('repeatNow').addEventListener('click', () => {
      // Optionally broadcast an instructor message to students (demo)
      try {
        const bc = new BroadcastChannel('ta-help-channel');
        bc.postMessage({ type: 'instructor_say', message: 'Instructor will repeat the current topic.' });
        bc.close();
      } catch (e) {
        console.debug('Broadcast instructor_say failed:', e);
      }
      overlay.remove();
    });
  }

  function prependRecentTimeline(req) {
    const feelingEmoji = { 'lost': '😵‍💫', 'kinda': '🤔', 'gotit': '✨' };
    const emoji = feelingEmoji[req.feeling] || '📝';

    const el = document.createElement('div');
    el.style.cssText = 'padding:10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid #667eea;font-size:12px;line-height:1.4;transition:all 0.3s ease;';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">${emoji}</span>
        <div style="flex:1;">
          <div style="font-weight:600;margin-bottom:2px;">${escapeHtml(req.studentName)}</div>
          <div style="color:var(--muted);font-size:11px;">${new Date(req.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
    `;
    recentTimeline.prepend(el);
    // limit entries
    while (recentTimeline.children.length > 50) recentTimeline.removeChild(recentTimeline.lastChild);
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  // Clear all button
  const clearBtn = document.getElementById('clearAllBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => { state.requests = []; renderRequests(); });

  // ==================== QUIZ GENERATION ====================
  const API_CONVERSE = '/api/agent/converse';

  // Quiz modal elements
  const quizModal = document.getElementById('quizModal');
  const closeQuizModal = document.getElementById('closeQuizModal');
  const generateQuizBtn = document.getElementById('generateQuizBtn');
  const quizLoadingState = document.getElementById('quizLoadingState');
  const quizContent = document.getElementById('quizContent');
  const quizText = document.getElementById('quizText');
  const publishQuizBtn = document.getElementById('publishQuizBtn');
  const downloadQuizBtn = document.getElementById('downloadQuizBtn');

  let generatedQuizText = '';

  // Generate quiz button
  if (generateQuizBtn) {
    generateQuizBtn.addEventListener('click', async () => {
      // Open modal
      quizModal.style.display = 'flex';
      quizLoadingState.style.display = 'block';
      quizContent.style.display = 'none';

      // Simulate loading delay for realism
      setTimeout(() => {
        // Generate dummy quiz
        const dummyQuiz = generateDummyQuiz();
        generatedQuizText = dummyQuiz;
        displayQuiz(dummyQuiz);
      }, 1500);
    });
  }

  function generateDummyQuiz() {
    return `# Database Fundamentals Quiz
Based on Today's Lecture

## Multiple Choice Questions

**1. What does the 'A' in ACID stand for?**
a) Availability
b) Atomicity
c) Authentication
d) Authorization

**2. Which normal form eliminates partial dependencies?**
a) 1NF
b) 2NF
c) 3NF
d) BCNF

**3. Which SQL JOIN returns all records from both tables, matching where possible?**
a) INNER JOIN
b) LEFT JOIN
c) RIGHT JOIN
d) FULL OUTER JOIN

**4. What data structure is commonly used for database indexing?**
a) Linked List
b) Hash Table
c) B-Tree
d) Binary Search Tree

**5. Which indexing technique is best for equality searches?**
a) B-Tree Index
b) Hash Index
c) Bitmap Index
d) Full-Text Index

## Short Answer Questions

**6. Explain the difference between 2NF and 3NF in database normalization.**

**7. Describe how a B-Tree maintains balance when inserting new records.**

**8. What is the difference between a clustered and non-clustered index?**

**9. List three query optimization techniques that can improve database performance.**

**10. Why are hash indexes not suitable for range queries?**

---
Generated by TA-DA AI Assistant <3`;
  }

  // Close quiz modal
  if (closeQuizModal) {
    closeQuizModal.addEventListener('click', () => {
      quizModal.style.display = 'none';
    });
  }

  // Click outside modal to close
  if (quizModal) {
    quizModal.addEventListener('click', (e) => {
      if (e.target === quizModal) {
        quizModal.style.display = 'none';
      }
    });
  }

  // Publish quiz button
  if (publishQuizBtn) {
    publishQuizBtn.addEventListener('click', () => {
      // Broadcast quiz to students via BroadcastChannel
      try {
        const bc = new BroadcastChannel('ta-help-channel');
        bc.postMessage({
          type: 'quiz_published',
          quiz: generatedQuizText,
          timestamp: Date.now()
        });
        bc.close();

        // Show success feedback
        const originalText = publishQuizBtn.innerHTML;
        publishQuizBtn.innerHTML = '✓ Published!';
        publishQuizBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)';
        setTimeout(() => {
          publishQuizBtn.innerHTML = originalText;
          publishQuizBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 2000);
      } catch (e) {
        console.debug('Broadcast quiz failed:', e);
        alert('Quiz published! (Note: Students need to have the app open to receive it)');
      }
    });
  }

  // Download quiz button
  if (downloadQuizBtn) {
    downloadQuizBtn.addEventListener('click', () => {
      const blob = new Blob([generatedQuizText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lecture-quiz-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function gatherLectureInfo() {
    // Gather information from the session
    const topics = [];

    // Get recent timeline entries
    if (recentTimeline && recentTimeline.children.length > 0) {
      topics.push('Recent classroom activity:');
      Array.from(recentTimeline.children).slice(0, 10).forEach(entry => {
        const text = entry.textContent.trim();
        if (text) topics.push(`- ${text}`);
      });
    }

    // Get stats
    topics.push(`\nClass engagement:`);
    topics.push(`- ${state.stats.lost} students feeling lost`);
    topics.push(`- ${state.stats.kinda} students somewhat understanding`);
    topics.push(`- ${state.stats.gotit} students fully understanding`);

    // Get help requests topics
    if (state.requests.length > 0) {
      topics.push(`\nCommon questions/concerns:`);
      state.requests.forEach(req => {
        if (req.message) {
          topics.push(`- ${req.message}`);
        }
      });
    }

    const info = topics.join('\n');

    // If no specific info, provide a generic prompt
    if (topics.length < 3) {
      return 'Today\'s lecture (no specific topics captured yet). Please generate a general assessment quiz covering fundamental concepts that would be covered in a typical lecture session.';
    }

    return info;
  }

  function displayQuiz(quizHtml) {
    // Convert markdown-style formatting to HTML
    let formatted = escapeHtml(quizHtml);

    // Format headers (lines starting with #)
    formatted = formatted.replace(/^### (.+)$/gm, '<h4 style="font-size:16px;font-weight:700;margin:20px 0 12px 0;color:#667eea;">$1</h4>');
    formatted = formatted.replace(/^## (.+)$/gm, '<h3 style="font-size:18px;font-weight:700;margin:24px 0 16px 0;color:#667eea;">$1</h3>');
    formatted = formatted.replace(/^# (.+)$/gm, '<h2 style="font-size:20px;font-weight:700;margin:28px 0 16px 0;color:#667eea;">$1</h2>');

    // Format bold text
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;">$1</strong>');

    // Format lists
    formatted = formatted.replace(/^- (.+)$/gm, '<div style="margin:8px 0 8px 20px;">• $1</div>');
    formatted = formatted.replace(/^\d+\. (.+)$/gm, '<div style="margin:8px 0 8px 20px;">$&</div>');

    // Format line breaks
    formatted = formatted.replace(/\n\n/g, '<br><br>');
    formatted = formatted.replace(/\n/g, '<br>');

    quizText.innerHTML = formatted;
    quizLoadingState.style.display = 'none';
    quizContent.style.display = 'block';
  }

  function extractAgentMessage(data) {
    // Extract agent message from API response
    if (data.response) return data.response;
    if (data.message) return data.message;
    if (data.output) return data.output;
    if (typeof data === 'string') return data;
    return 'Quiz generated successfully!';
  }

  // Listen for BroadcastChannel messages
  try {
    const bc = new BroadcastChannel('ta-help-channel');
    bc.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'help_request') {
        addRequest(msg);
        return;
      }

      if (msg.type === 'feeling_update') {
        // Update aggregate feeling stats
        const feeling = msg.feeling;
        // track seen student
        if (msg.studentName) state.seenStudents.add(msg.studentName);
        if (feeling === 'lost') state.stats.lost++;
        else if (feeling === 'kinda') state.stats.kinda++;
        else if (feeling === 'gotit') state.stats.gotit++;
        renderStats();

        // Optionally show a tiny timeline entry
        prependRecentTimeline({ studentName: msg.studentName || 'Student', feeling, timestamp: msg.timestamp });
        checkRepeatSuggestion();
        return;
      }

      if (msg.type === 'help_ack') {
        // If another tab acknowledged, reflect that in UI if matching id
        const ackId = msg.id;
        const idx = state.requests.findIndex(r => r.id === ackId || r.studentName === msg.studentName);
        if (idx !== -1) {
          state.requests[idx].acknowledged = true;
          state.requests[idx].ackBy = msg.ackBy || 'Instructor';
          state.requests[idx].ackAt = msg.ackAt || Date.now();
          renderRequests();
        }
      }
    };
  } catch (e) {
    // BroadcastChannel unavailable — fallback to polling window state if available
    console.debug('BroadcastChannel unavailable:', e);
  }

  // Init
  renderRequests();
  renderStats();

})();
