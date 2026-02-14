# Elastic indices

Index mappings and creation scripts for TA-DA.

## `ta-da-latest`

Index for **live Zoom transcript chunks** streamed from the Zoom agent. New chunks are appended; documents are never overwritten by the ingestion flow.

- **Create index:** see below or run [../scripts/create-ta-da-latest-index.sh](../scripts/create-ta-da-latest-index.sh).
- **How to index data (for other services):** [../INDEXING.md](../INDEXING.md).
- **Mapping:** [ta-da-latest.mapping.json](ta-da-latest.mapping.json).

## Creating `ta-da-latest` (one-time)

### Option 1: Kibana Dev Tools (recommended — full mapping in one go)

1. Open **Kibana** (your Elastic Cloud Kibana URL).
2. In the left sidebar, click **Dev Tools** (wrench icon), or go to **Management → Dev Tools**.
3. In the **Console** tab, paste the request below and click the green **Play** button (or press Ctrl/Cmd+Enter).

### Option 2: Kibana Index Management UI

1. Open **Kibana** → **Menu (≡)** → **Management** → **Stack Management**.
2. In the left sidebar, under **Kibana**, click **Index Management** (or **Data** → **Index Management**).
3. Click **Create index**.
4. Enter **Index name:** `ta-da-latest`.
5. If the form has a **Mappings** or **Index settings** section, you can paste the mapping from [ta-da-latest.mapping.json](ta-da-latest.mapping.json). If the UI only lets you add fields one by one, use **Option 1 (Dev Tools)** so the full mapping is applied.

---

### Dev Tools request (copy-paste)

```json
PUT /ta-da-latest
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "dynamic": "true",
    "properties": {
      "meeting_id": { "type": "keyword", "doc_values": true },
      "meeting_start_time": { "type": "date", "format": "strict_date_optional_time||epoch_millis" },
      "chunk_index": { "type": "integer" },
      "text": {
        "type": "text",
        "fields": { "keyword": { "type": "keyword", "ignore_above": 512 } }
      },
      "start_time": { "type": "float", "doc_values": true },
      "end_time": { "type": "float", "doc_values": true },
      "speaker_id": { "type": "keyword" },
      "received_at": { "type": "date", "format": "strict_date_optional_time||epoch_millis" },
      "source": { "type": "keyword" }
    }
  }
}
```

Or use the script: `../scripts/create-ta-da-latest-index.sh` (requires `ELASTICSEARCH_URL` and `ELASTIC_API_KEY`).

---

### Delete all documents in `ta-da-latest` (keep index)

**Kibana Dev Tools:**
```json
POST /ta-da-latest/_delete_by_query
{
  "query": { "match_all": {} }
}
```

**Python (same env as index-test-chunk.py):**
```bash
export ELASTIC_API_KEY="your-api-key"
python3 elastic/scripts/delete-all-docs.py
```
Optional: `INDEX_NAME=other-index` to target a different index.

---

## Agent indices (Tutor + ClassOps)

Shared storage for the Fetch.ai agents. Create all at once with [../scripts/create-agent-indices.py](../scripts/create-agent-indices.py) (requires `ELASTICSEARCH_URL`, `ELASTIC_API_KEY`).

| Index | Purpose |
|-------|--------|
| **ta-da-users** | `user_id`, `name`, `role` (student/instructor) |
| **ta-da-sessions** | `session_id`, `meeting_id`, `start_time`, `active_concept` |
| **ta-da-concept-cards** | `session_id`, `concept_id`, `title`, `short_explain`, `example`, `timestamp` |
| **ta-da-signals** | `session_id`, `user_id`, `concept_id`, `signal_type` (lost/kinda/gotit), `time` |
| **ta-da-tutor-turns** | `session_id`, `user_id`, `concept_id`, `turn_id`, `user_msg`, `agent_msg`, `stage`, `correctness` |
| **ta-da-session-state** | ClassOps output: `session_id`, `top_concept_id`, `re_explain_suggestion`, `poll_question`, `updated_at` |

- **Mapping files:** [ta-da-users.mapping.json](ta-da-users.mapping.json), [ta-da-sessions.mapping.json](ta-da-sessions.mapping.json), [ta-da-concept-cards.mapping.json](ta-da-concept-cards.mapping.json), [ta-da-signals.mapping.json](ta-da-signals.mapping.json), [ta-da-tutor-turns.mapping.json](ta-da-tutor-turns.mapping.json), [ta-da-session-state.mapping.json](ta-da-session-state.mapping.json).
