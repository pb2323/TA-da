#!/usr/bin/env python3
"""
Delete all documents in an index. Keeps the index and mapping.
Use for ta-da-latest (or set INDEX_NAME env var).

Setup: same as index-test-chunk.py (venv, requirements-elastic.txt)
Env: ELASTICSEARCH_URL (optional), ELASTIC_API_KEY (required), INDEX_NAME (default: ta-da-latest)
"""

import os
from elasticsearch import Elasticsearch

ES_URL = os.environ.get(
    "ELASTICSEARCH_URL",
    "https://my-elasticsearch-project-f5fc5f.es.us-west1.gcp.elastic.cloud:443",
)
API_KEY = os.environ.get("ELASTIC_API_KEY", "")
INDEX_NAME = os.environ.get("INDEX_NAME", "ta-da-latest")

client = Elasticsearch(ES_URL, api_key=API_KEY)


def main():
    if not API_KEY:
        print("Set ELASTIC_API_KEY and run again.")
        return
    resp = client.delete_by_query(
        index=INDEX_NAME,
        body={"query": {"match_all": {}}},
    )
    deleted = resp.get("deleted", 0)
    print(f"Deleted {deleted} document(s) from index '{INDEX_NAME}'.")


if __name__ == "__main__":
    main()
