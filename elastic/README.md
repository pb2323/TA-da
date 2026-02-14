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

- **Indexing (e.g. transcript chunks):** `ELASTICSEARCH_URL`, `ELASTIC_API_KEY` — no Cloud ID required. See [INDEXING.md](INDEXING.md) and [scripts/index-test-chunk.py](scripts/index-test-chunk.py).
- **MCP / Kibana:** Kibana URL and API key (see MCP section below).

---

## Accessing data via Agent Builder MCP server

You can query your uploaded dataset (and use Agent Builder tools/agents) from Cursor or other MCP clients using the [Elastic Agent Builder MCP server](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server).

### What you need to provide

1. **Kibana URL** — Your Elastic Cloud Kibana URL (e.g. `https://xxxxx.kb.us-central1.gcp.cloud.es.io`).
2. **API key** — A Kibana API key with [application privileges](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server#api-key-application-privileges) for Agent Builder (e.g. `read_onechat`, `space_read`).  
   If you use a **custom Kibana Space**, use: `{KIBANA_URL}/s/{SPACE_NAME}/api/agent_builder/mcp` in the config.

### Create an API key (dev/testing)

In Kibana: **Management → Stack Management → API Keys**, or via Elasticsearch:

```json
POST /_security/api_key
{
  "name": "ta-da-mcp-api-key",
  "expiration": "30d",
  "role_descriptors": {
    "mcp-access": {
      "cluster": ["all"],
      "indices": [{ "names": ["*"], "privileges": ["read", "view_index_metadata"] }],
      "applications": [{
        "application": "kibana-.kibana",
        "privileges": ["read_onechat", "space_read"],
        "resources": ["space:default"]
      }]
    }
  }
}
```

Use the returned `id` + `api_key` to form: `ApiKey <base64(id:api_key)>`, or create the key in the UI and copy the encoded key.

### Configure Cursor (or another MCP client)

1. Copy the example config into your Cursor MCP config:
   - **macOS:** `~/.cursor/config/mcp.json`
   - **Windows:** `%USERPROFILE%\.cursor\config\mcp.json`
   - If you already have other servers, merge the `elastic-agent-builder` entry into `mcpServers`.

2. Use the **full URL and full header in `args`** (Cursor does not expand env vars in `args`, so `${KIBANA_URL}` would be passed literally and cause "Invalid URL"):

```json
{
  "mcpServers": {
    "elastic-agent-builder": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://my-elasticsearch-project-f5fc5f.kb.us-west1.gcp.elastic.cloud/api/agent_builder/mcp",
        "--header",
        "Authorization:ApiKey YOUR_ACTUAL_API_KEY"
      ]
    }
  }
}
```

Replace `YOUR_ACTUAL_API_KEY` with your Kibana API key. For a different deployment, change the URL in the second `args` entry.

3. Restart Cursor (or reload MCP). The Elastic Agent Builder tools will appear and you can use them to search/query your dataset and call agents.

Example config for this repo: [mcp-config.example.json](mcp-config.example.json).

### Troubleshooting

- **`TypeError: Invalid URL` / `input: '${KIBANA_URL}/api/agent_builder/mcp'`** — Cursor does not substitute environment variables in the `args` array. Use the full Kibana URL and full `Authorization:ApiKey ...` header directly in `args` (see config above). Do not use `env` with `${KIBANA_URL}` in `args`.

### References

- [Programmatic access to Elastic Agent Builder](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/programmatic-access)
- [Elastic Agent Builder MCP server](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server)

---

## Indexing data into `ta-da-latest` (for external services)

Any service (Zoom agent, backend, or other) that needs to **index transcript chunks** must use the same index and document shape so data is queryable and consistent.

- **Full contract (payload, fields, examples, how to index):** [INDEXING.md](INDEXING.md)
- **Index creation (one-time):** [indices/README.md](indices/README.md) or script [scripts/create-ta-da-latest-index.sh](scripts/create-ta-da-latest-index.sh)
- **Indexing example (Python):** [scripts/index-test-chunk.py](scripts/index-test-chunk.py) — reference script to index chunks. Uses **`ELASTICSEARCH_URL`** and **`ELASTIC_API_KEY`** only (no Cloud ID). Requires `requirements-elastic.txt` and a venv.

---

## Related

- Backend: [backend](../backend/)
- Fetch.ai agents: [fetch-ai](../fetch-ai/)
