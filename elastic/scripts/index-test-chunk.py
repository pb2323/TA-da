#!/usr/bin/env python3
"""
Index one test transcript chunk into ta-da-latest for testing.
Contract and field definitions: see elastic/INDEXING.md

Setup (from repo root):
  python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements-elastic.txt
Env: ELASTICSEARCH_URL (optional), ELASTIC_API_KEY (required)
"""

import os
from datetime import datetime, timezone
from elasticsearch import Elasticsearch

ES_URL = os.environ.get(
    "ELASTICSEARCH_URL",
    "https://my-elasticsearch-project-f5fc5f.es.us-west1.gcp.elastic.cloud:443",
)
API_KEY = os.environ.get("ELASTIC_API_KEY", "")

client = Elasticsearch(ES_URL, api_key=API_KEY)
index_name = "ta-da-latest"

# One test chunk – content chosen so you can query it semantically (e.g. "ACID" or "database transactions")
test_chunk = {
    "meeting_id": "test-meeting-001",
    "chunk_index": 0,
    "text": (
        "Welcome to the session. Today we'll cover ACID properties in databases. "
        "ACID stands for Atomicity, Consistency, Isolation, and Durability. "
        "These four properties guarantee that database transactions are reliable and predictable."
    ),
    "start_time": 0.0,
    "end_time": 12.5,
    "speaker_id": "instructor",
    "meeting_start_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "received_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": "zoom_agent",
}


def main():
    if not API_KEY:
        print("Set ELASTIC_API_KEY and run again.")
        return
    resp = client.index(index=index_name, document=test_chunk)
    print("Indexed test chunk:", resp.get("result"), "id:", resp.get("_id"))


if __name__ == "__main__":
    main()
