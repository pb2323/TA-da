# Backend (Render)

API and event router for TA-DA. Zoom App UI sends events here; the backend routes them to the Tutor or ClassOps agent (or updates Elastic for CONCEPT_SET).

## Event endpoint: POST /events

Body must include `type` (or `event_type`) and the payload for that type:

| type | Payload | Action |
|------|---------|--------|
| `SIGNAL_SUBMIT` | `session_id`, `user_id`, `concept_id`, `signal` (lost/kinda/gotit) | Forward to ClassOps `POST /signal` |
| `QUESTION_SUBMIT` | `session_id`, `user_id`, `concept_id`, `question_text` | Forward to Tutor `POST /question` |
| `TUTOR_REPLY` | `session_id`, `user_id`, `concept_id`, `user_text` | Forward to Tutor `POST /reply` |
| `CONCEPT_SET` | `session_id`, `concept_id` | Update `ta-da-sessions` active_concept (Elastic) |

## Semantic search: POST /search/semantic

For Zoom or backend: search transcript chunks in `ta-da-latest` by natural-language query (semantic search on the `content` field).

**Request:** `POST /search/semantic`  
**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Natural-language search query (e.g. `"normalization 2NF 3NF"`). |
| `meeting_id` | string | No | Restrict results to this meeting. |
| `size` | number | No | Max hits to return (default 10, max 100). |

**Response:** `{ "hits": [ { "_id", "_score", "meeting_id", "chunk_index", "text", "start_time", "end_time", ... } ] }`

Requires `ELASTICSEARCH_URL` and `ELASTIC_API_KEY`.

## Agent converse: POST /agent/converse

Proxies to Elastic Agent Builder converse API. Ask the TA-DA agent a question; it searches indexed transcripts and responds.

**Request:** `POST /agent/converse`  
**Body:** `{ "input": "What is ACID?", "agent_id"?: "tada-agent" }`  
**Response:** Full converse API response (`conversation_id`, `steps`, `response.message`, etc.)

Requires `ELASTIC_API_KEY`; uses `KIBANA_URL` or derives from `ELASTICSEARCH_URL`.

## Tech stack

- Node.js (Express), ES modules
- Render (API service)

## Environment

- `PORT` — Server port (default 3000)
- `TUTOR_AGENT_URL` — Base URL of Tutor agent (e.g. `http://localhost:5001` or Render service URL)
- `CLASSOPS_AGENT_URL` — Base URL of ClassOps agent (e.g. `http://localhost:5002`)
- `ELASTICSEARCH_URL`, `ELASTIC_API_KEY` — Required for CONCEPT_SET (update sessions); also used for transcript indexing (see [elastic/INDEXING.md](../elastic/INDEXING.md))

## Run locally

```bash
cd backend && npm install && npm run dev
```

Set env vars (or `.env`) and ensure Tutor and ClassOps agents are running on the URLs above.

## Related

- Fetch.ai agents (Tutor, ClassOps): [fetch-ai](../fetch-ai/)
- Elastic: [elastic](../elastic/)
- Frontend: [frontend](../frontend/)
