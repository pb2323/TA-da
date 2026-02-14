#!/usr/bin/env python3
"""
Run semantic search on ta-da-latest using the retriever API (semantic on field 'text').
Same logic as MCP platform_core_search: different queries should return different top hits.

Usage:
  python3 elastic/scripts/semantic-search.py
  python3 elastic/scripts/semantic-search.py "your query here"

Env: ELASTICSEARCH_URL (optional), ELASTIC_API_KEY (required)
"""

import json
import os
import sys
from elasticsearch import Elasticsearch

ES_URL = os.environ.get(
    "ELASTICSEARCH_URL",
    "https://my-elasticsearch-project-f5fc5f.es.us-west1.gcp.elastic.cloud:443",
)
API_KEY = os.environ.get("ELASTIC_API_KEY", "")

client = Elasticsearch(ES_URL, api_key=API_KEY)
INDEX = "ta-da-latest"


def search_semantic(query: str, size: int = 5):
    retriever_object = {
        "standard": {
            "query": {
                "semantic": {
                    "field": "text",
                    "query": query,
                }
            }
        }
    }
    response = client.search(index=INDEX, retriever=retriever_object, size=size)
    return response


def main():
    if not API_KEY:
        print("Set ELASTIC_API_KEY and run again.")
        return 1

    # If a query is passed on the command line, run only that query
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        response = search_semantic(query, size=5)
        print("=== Full response (no truncation) ===\n")
        print(json.dumps(response, indent=2, default=str))
        return 0

    # Otherwise run the same 5 semantic queries we used with MCP
    queries = [
        "What are the four properties that make database transactions reliable and durable?",
        "How do we remove redundancy and partial dependencies in database design?",
        "How do we combine rows from two tables and handle unmatched rows?",
        "What tree structures are used for fast lookups and range queries in databases?",
        "How do we prevent dirty reads and lost updates when many transactions run together?",
    ]
    expected_topics = ["ACID", "normalization", "SQL joins", "indexing/B-tree", "concurrency"]

    print("Semantic search (retriever API) – full response per query (no truncation)\n")
    for query, topic in zip(queries, expected_topics):
        response = search_semantic(query, size=1)
        print(f"=== Query ({topic}): {query} ===\n")
        print(json.dumps(response, indent=2, default=str))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
