#!/usr/bin/env python3
"""
Create all agent-related Elasticsearch indices (users, sessions, concept_cards, signals, tutor_turns, session_state).
Uses mapping JSON files from elastic/indices/. Requires ELASTICSEARCH_URL and ELASTIC_API_KEY.
"""

import json
import os
from pathlib import Path

from elasticsearch import Elasticsearch

ES_URL = os.environ.get("ELASTICSEARCH_URL", "https://localhost:9200")
API_KEY = os.environ.get("ELASTIC_API_KEY", "")
INDICES_DIR = Path(__file__).resolve().parent.parent / "indices"

INDEX_SPECS = [
    ("ta-da-users", "ta-da-users.mapping.json"),
    ("ta-da-sessions", "ta-da-sessions.mapping.json"),
    ("ta-da-concept-cards", "ta-da-concept-cards.mapping.json"),
    ("ta-da-signals", "ta-da-signals.mapping.json"),
    ("ta-da-tutor-turns", "ta-da-tutor-turns.mapping.json"),
    ("ta-da-session-state", "ta-da-session-state.mapping.json"),
    ("ta-da-latest", "ta-da-latest.mapping.json"),
]


def main():
    if not API_KEY:
        print("Set ELASTIC_API_KEY and run again.")
        return
    client = Elasticsearch(ES_URL, api_key=API_KEY)
    for index_name, mapping_file in INDEX_SPECS:
        path = INDICES_DIR / mapping_file
        if not path.exists():
            print(f"Skip {index_name}: {mapping_file} not found")
            continue
        with open(path) as f:
            body = json.load(f)
        # Strip shard/replica settings — not allowed in Elastic Cloud Serverless
        if "settings" in body:
            body["settings"].pop("number_of_shards", None)
            body["settings"].pop("number_of_replicas", None)
        if client.indices.exists(index=index_name):
            print(f"Index {index_name} already exists, skipping.")
            continue
        client.indices.create(index=index_name, **body)
        print(f"Created index: {index_name}")
    print("Done.")


if __name__ == "__main__":
    main()
