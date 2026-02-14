# TA-DA!

**A Live Zoom Teaching Assistant that Detects Confusion, Fixes It in the Moment, and Verifies Understanding**

Built at TreeHacks 2026.

---

## What is TA-DA?

TA-DA! is a real-time AI Teaching Assistant built directly inside Zoom. It transforms passive lectures into an active learning loop:

**Sense confusion → Intervene instantly → Verify understanding → Generate personalized next steps**

Unlike traditional meeting tools that just transcribe or summarize, TA-DA actively changes what happens during class and closes the learning loop afterward.

---

## The Problem

Live classes fail for predictable reasons:

- Instructors don't know what isn't landing
- Questions don't scale (duplicates, vague, shy students)
- No verification of understanding
- Students leave without clear next steps

Most tools are passive. **TA-DA is active.**

---

## What It Does

| Feature | Description |
|--------|-------------|
| **Live Concept Cards** | Auto-generated during lecture: concept name, short explanation, example, timestamp, and one quick check question. Builds a live "course memory." |
| **Real-Time Confusion Heatmap** | Students signal Lost / Kinda / Got it / Question. TA-DA clusters signals, surfaces top confusing concepts, duplicate questions, and suggested interventions. |
| **Instructor Intervention Engine** | On confusion spike, instructor can generate a 30-second re-explain (simpler analogy, reframed explanation, quick poll). Optional HeyGen Avatar reads it live. |
| **Multi-Turn Diagnostic Tutor** | Agentic core: clarifying questions, targeted explanations, check questions, adaptation, and student learning profile updates. |
| **Learning Contract (After Class)** | Per student: what they struggled with, what they nailed, 2 micro-practice actions (≤10 min), 3-question verification. Instructor gets concept-by-concept understanding %, top misconceptions, and suggested tweaks. |

---

## Architecture

| Layer | Tech | Location |
|-------|------|----------|
| **Frontend** | Zoom App (in-meeting side panel), Next.js on Vercel | [frontend](frontend/) |
| **Backend** | Render (API, WebSocket, background worker) | [backend](backend/) |
| **Memory & retrieval** | Elastic Cloud, Jina embeddings, hybrid retrieval | [elastic](elastic/) |
| **Multi-agent** | Fetch.ai (Moments, Confusion, Tutor, Contract agents) | [fetch-ai](fetch-ai/) |
| **Research** | Perplexity Sonar API (sources, misconception detection) | [perplexity](perplexity/) |
| **Avatar (optional)** | HeyGen Avatar API (re-explain mode) | [heygen](heygen/) |

---

## Sponsor Alignment

TA-DA is designed to be award-eligible across:

- **Zoom × Render** — In-meeting app + real-time backend
- **Elastic** — End-to-end agentic system on Elasticsearch
- **Fetch.ai** — Multi-agent workflow + monetization-ready
- **HeyGen** — Real-time avatar integration
- **Vercel** — Production-ready deployed app
- **Perplexity Sonar** — Grounded research + citations

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/pb2323/TA-da
cd TA-da
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Create `.env.local` with:

```env
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ELASTICSEARCH_URL=
ELASTIC_API_KEY=
RENDER_BACKEND_URL=
SONAR_API_KEY=
HEYGEN_API_KEY=
FETCH_AGENTVERSE_KEY=
```

### 4. Run locally

```bash
npm run dev
```

### 5. Deploy

- **Frontend:** Deploy to Vercel  
- **Backend:** Deploy API + worker to Render  
- **Elastic:** Provision Elastic Cloud cluster; configure Jina embeddings inference endpoint  

---

## Demo Script (2-minute flow)

1. Start Zoom mini-lecture  
2. Concept cards appear live  
3. Two students hit "Lost" → instructor dashboard updates  
4. Click "Generate 30-sec re-explain"  
5. Student asks question → TA-DA runs multi-turn diagnostic  
6. End class → show Learning Contract  

---

## Vision

TA-DA turns Zoom from a video platform into a **Learning Operations System**: not just notes or summaries, but a closed-loop intelligence layer for real-time education.

---

## Repository structure

- [frontend](frontend/) — Next.js app (Vercel) + Zoom in-meeting UI  
- [backend](backend/) — Render API, WebSocket server, workers  
- [elastic](elastic/) — Elastic Cloud, search, concept cards, embeddings  
- [fetch-ai](fetch-ai/) — Multi-agent layer (Agentverse)  
- [heygen](heygen/) — HeyGen avatar integration  
- [perplexity](perplexity/) — Perplexity Sonar research & verification  
- [docs](docs/) — Architecture, demo script, and design notes  

---

**Team** — Built at TreeHacks 2026. 36 hours. One mission: make learning adaptive in real time.
