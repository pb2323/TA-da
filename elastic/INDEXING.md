# Indexing data into `ta-da-latest`

This document is the **contract for any service** (Zoom agent, backend, or other) that needs to **index transcript chunks** into the TA-DA Elasticsearch index. Follow this and your data will be queryable and consistent with the rest of the system.

---

## 1. Index name

- **Index:** `ta-da-latest`
- **Purpose:** Live meeting transcript chunks. One index for all meetings; each document has a `meeting_id` so you can filter by meeting.
- **Behavior:** Append-only. Each index request adds a **new document**; existing documents are never updated or overwritten by this flow.

---

## 2. Document shape (payload)

Every document **must** include these fields. Optional fields can be omitted or set to `null`.

### Required

| Field         | Type   | Description |
|---------------|--------|-------------|
| `meeting_id`  | string | Unique identifier for the meeting (e.g. Zoom meeting ID). Used to filter chunks by meeting. |
| `chunk_index` | number | Order of this chunk in the stream for this meeting (0, 1, 2, …). |
| `text`        | string | The transcript text for this segment. This is the main searchable content. |

### Optional (recommended when available)

| Field                | Type   | Description |
|----------------------|--------|-------------|
| `start_time`         | number | Start time of this segment in seconds (float). |
| `end_time`           | number | End time of this segment in seconds (float). |
| `speaker_id`         | string | Identifier for who spoke (e.g. `instructor`, `student_1`). |
| `meeting_start_time` | string | ISO 8601 date/time when the meeting started (e.g. `2026-02-14T10:00:00Z`). |
| `source`             | string | Origin of the data (e.g. `zoom_agent`). Default: `zoom_agent`. |

### Set by the indexer (your service)

| Field        | Type   | Description |
|--------------|--------|-------------|
| `received_at`| string | ISO 8601 date/time when the chunk was received/indexed. Set by your service before sending to Elasticsearch. |

---

## 3. Example document (JSON)

```json
{
  "meeting_id": "abc123-zoom-meeting-id",
  "chunk_index": 0,
  "text": "Welcome to the session. Today we'll cover ACID properties in databases.",
  "start_time": 0.0,
  "end_time": 5.2,
  "speaker_id": "instructor",
  "meeting_start_time": "2026-02-14T10:00:00Z",
  "received_at": "2026-02-14T10:00:01Z",
  "source": "zoom_agent"
}
```

---

## 4. How to index

- **Elasticsearch API:** Use the [Index API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-index_.html) or [Bulk API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html).
  - **Index:** `ta-da-latest`
  - **Document body:** The JSON above (required + any optional fields).
  - **Document ID:** Omit `_id` so Elasticsearch auto-generates one. That keeps every chunk a separate document (append-only).
- **Authentication:** Use your Elasticsearch URL and an API key with **index** / **create_doc** permission on `ta-da-latest`. You do **not** need Cloud ID — the Elasticsearch base URL and API key are enough.

### Example (Python)

Use [scripts/index-test-chunk.py](scripts/index-test-chunk.py) as the reference. It needs only **`ELASTICSEARCH_URL`** and **`ELASTIC_API_KEY`** (no Cloud ID).

**Setup (from repo root):**
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-elastic.txt
export ELASTICSEARCH_URL="https://YOUR_ES_HOST:443"   # optional if default in script
export ELASTIC_API_KEY="your-api-key"
python3 elastic/scripts/index-test-chunk.py
```

The script connects with `Elasticsearch(ES_URL, api_key=API_KEY)` and indexes one document. Adapt the `test_chunk` dict for your chunks (same fields as section 2). For bulk indexing, use the same client and loop `client.index(index=index_name, document=doc)` or the [Bulk API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html).

### Example (curl)

```bash
curl -X POST "https://YOUR_ES_URL/ta-da-latest/_doc" \
  -H "Authorization: ApiKey YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_id": "meeting-123",
    "chunk_index": 0,
    "text": "First segment of the transcript.",
    "received_at": "2026-02-14T10:00:00Z",
    "source": "zoom_agent"
  }'
```

---

## 5. Index setup (one-time)

Before any service indexes data, the index `ta-da-latest` must exist with the correct mapping. If it does not:

- **Option A:** Use Kibana **Dev Tools** and run the `PUT /ta-da-latest` request from [indices/README.md](indices/README.md).
- **Option B:** Run `scripts/create-ta-da-latest-index.sh` (set `ELASTICSEARCH_URL` and `ELASTIC_API_KEY` or `KIBANA_URL` and `AUTH_HEADER`).

Full mapping reference: [indices/ta-da-latest.mapping.json](indices/ta-da-latest.mapping.json).

---

## 6. Summary for implementers

1. Ensure the index `ta-da-latest` exists (see section 5).
2. For each transcript chunk, build a document with **at least** `meeting_id`, `chunk_index`, and `text`; add optional fields and `received_at` when you have them.
3. POST the document to `ta-da-latest` (Index API or Bulk API) without specifying `_id`.
4. Repeat for every new chunk; each request appends a new document.
