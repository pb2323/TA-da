# Elastic (Memory & Retrieval)

Elastic Cloud and search stack for TA-DA’s “course memory” and retrieval.

## Responsibilities

- **Concept cards** — Store and index live-generated concept cards
- **Transcript chunks** — Indexed for semantic and lexical search
- **Confusion signals** — Stored and queried for heatmaps and clusters
- **Question clusters** — Duplicate detection and grouping
- **Jina embeddings** — Semantic search; hybrid retrieval (vector + lexical)
- **Elastic Agent Builder + Workflows** — Post-class automation (e.g. contract generation)

## Tech stack

- Elastic Cloud (Elasticsearch)
- Jina embeddings (inference endpoint)
- Hybrid retrieval (vector + lexical)

## Environment

- `ELASTIC_CLOUD_ID`
- `ELASTIC_API_KEY`

## Related

- Backend: [backend](../backend/)
- Fetch.ai agents: [fetch-ai](../fetch-ai/)
