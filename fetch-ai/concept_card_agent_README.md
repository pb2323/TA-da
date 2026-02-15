# TA-DA Concept Card Agent

## Overview

An autonomous agent that detects when lecture concepts are completed and generates concept cards from live transcripts. It uses the Fetch.ai uAgents framework with the Chat Protocol and integrates with Elasticsearch and an LLM (xAI Grok or OpenAI) for topic-boundary detection and concept extraction.

## Purpose

Acts as the "Concept Card Agent" for TA-DA: it builds a live "course memory" by turning completed lecture segments into structured concept cards (title, short explanation, example, timestamp) that can be shown in the Zoom app and used by other agents (tutor, confusion heatmap, learning contract).

## Responsibilities

### Core Capabilities

- **Topic completion detection** — Polls transcript chunks from `ta-da-latest`, compares current vs previous conversation state, and identifies when a new concept has started (topic boundary). When a boundary is detected, the previous segment is treated as a completed concept.
- **Concept card creation** — For each completed segment, uses an LLM to extract a title, short explanation, and example, then indexes a document into `ta-da-concept-cards`.

### Tools

| Tool | Purpose |
|------|---------|
| **detect_concept_completion** | Runs on a schedule; fetches recent chunks, loads prior state, calls LLM to detect topic boundaries; invokes create_concept_card when a boundary is found. |
| **create_concept_card** | Takes a completed segment (chunk range), runs LLM extraction, and indexes to `ta-da-concept-cards`. |

## Input

- **Transcript chunks** — From `ta-da-latest` (populated by the existing transcript indexing pipeline). Chunks have `meeting_id`, `chunk_index`, `text`, `start_time`, `end_time`.
- **Meetings** — From `ta-da-sessions` (`meeting_id`). The agent processes all meetings and fetches chunks per meeting.
- **Chat messages** — Via Chat Protocol: users can send natural language; the agent replies with a short description of its role.

## Output

- **Concept cards** — Documents in `ta-da-concept-cards`: `meeting_id`, `concept_id`, `title`, `short_explain`, `example`, `timestamp`.
- **Agent state** — Per-session state in `ta-da-concept-card-agent-state` (last chunk index, last topic summary) for the next comparison.

## Example Interactions (Chat)

- "What do you do?" → Agent describes its role (concept detection and card creation).
- "Run detection" / "Create a card" — Can be extended to trigger tools from chat.

## Technical Details

### Tech Stack

- **uAgents Framework** — Fetch.ai agent runtime
- **Chat Protocol** — ASI-1 compatible messaging (ChatMessage, ChatAcknowledgement)
- **Elasticsearch** — Transcript chunks, sessions, concept cards, agent state
- **LLM** — xAI Grok (default) or OpenAI for topic comparison and concept extraction
- **Python** — Core implementation

### Deployment

- **Transport** — HTTP server on configurable port (default 8010); optional mailbox for Agentverse
- **Identity** — Seed phrase from `CONCEPT_CARD_AGENT_SEED` (or placeholder)
- **Publish** — Agent details and manifest for discoverability

### Agent Configuration

```python
agent = Agent(
    name="concept-card-agent",
    seed=config.agent.seed or "concept_card_agent_seed_phrase_replace_in_production",
    port=config.agent.port,
    mailbox=True,
    publish_agent_details=True,
    readme_path="concept_card_agent_README.md"
)
```

### Environment

| Variable | Description |
|----------|-------------|
| `ELASTICSEARCH_URL` | Elastic Cloud URL |
| `ELASTIC_API_KEY` | Elastic API key |
| `XAI_API_KEY` | xAI API key (Grok); or use `OPENAI_API_KEY` |
| `LLM_BASE_URL` | `https://api.x.ai/v1` for xAI |
| `LLM_MODEL` | e.g. `grok-2`, `grok-4` |
| `CONCEPT_CARD_AGENT_PORT` | Default 8010 |
| `CONCEPT_CARD_AGENT_POLL_INTERVAL` | Seconds between detect_concept_completion runs (default 45) |

## Integration Points

- **ta-da-latest** — Read-only; transcript chunks (existing pipeline)
- **ta-da-sessions** — Read-only; session ↔ meeting mapping
- **ta-da-concept-cards** — Write; generated concept cards
- **ta-da-concept-card-agent-state** — Read/write; per-session state
- **Backend** — Optional: `POST /search/semantic`, `POST /events` (CONCEPT_SET)

## Limitations & Considerations

- Topic-boundary detection depends on LLM quality; false positives/negatives are possible.
- Polling interval trades latency vs API/LLM cost.
- Transcript ingestion is out of scope; a separate pipeline indexes into `ta-da-latest`.

## Tags & Discoverability

`concept-cards`, `ta-da`, `lecture`, `transcript`, `education`, `topic-detection`, `elasticsearch`

---

**Project**: TA-DA  
**Agent**: Concept Card Agent
