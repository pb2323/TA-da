# Backend (Render)

API, WebSocket server, and background workers for TA-DA.

## Responsibilities

- **REST API** — Auth, Zoom webhooks, agent triggers, learning contract requests
- **Zoom transcript ingestion** — Receive transcript chunks from the Zoom agent and append them to the `ta-da-latest` Elasticsearch index (see [elastic/README.md](../elastic/README.md#zoom-transcript-ingestion-ta-da-latest))
- **WebSocket server** — Live updates: concept cards, confusion heatmap, interventions
- **Background worker** — Learning Contract generation and post-class automation

## Tech stack

- Node.js (or your runtime of choice)
- Render (API + worker services)

## Environment

- `RENDER_BACKEND_URL` — Public URL of this backend (used by frontend and Zoom app)
- `ELASTIC_CLOUD_ID`, `ELASTIC_API_KEY` — For indexing Zoom transcript chunks into `ta-da-latest`

## Related

- Frontend: [frontend](../frontend/)
- Elastic: [elastic](../elastic/)
- Fetch.ai agents: [fetch-ai](../fetch-ai/)
