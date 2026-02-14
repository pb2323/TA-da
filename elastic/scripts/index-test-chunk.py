#!/usr/bin/env python3
"""
Index fifteen test transcript chunks into ta-da-latest with different topics.
Use different semantic queries to retrieve different chunks (e.g. "ACID", "normalization", "SQL joins", "B-tree indexing", "concurrency", "hash index", "query optimization", "CAP theorem", "NoSQL", "Redis cache", "deadlock", "triggers stored procedures", "data warehouse OLAP", "sharding horizontal scaling").

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

# Fifteen chunks with distinct topics so semantic search returns different results per query
TEST_CHUNKS = [
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 0,
        "text": (
            "Welcome to the session. Today we'll cover ACID properties in databases. "
            "ACID stands for Atomicity, Consistency, Isolation, and Durability. "
            "Atomicity means all or nothing—the transaction must fully complete or not at all. "
            "Consistency keeps the database in a valid state. Isolation means transactions do not interfere. "
            "Durability means once committed, changes are permanent even after a crash."
        ),
        "start_time": 0.0,
        "end_time": 15.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 1,
        "text": (
            "Next we have normalization. Normalization reduces redundancy and update anomalies. "
            "First normal form requires atomic values—no repeating groups. "
            "Second normal form removes partial dependencies; every non-key attribute must depend on the full primary key. "
            "Third normal form removes transitive dependencies. BCNF is stricter: every determinant must be a super key."
        ),
        "start_time": 15.0,
        "end_time": 32.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 2,
        "text": (
            "SQL joins combine rows from two or more tables. INNER JOIN returns only matching rows from both tables. "
            "LEFT JOIN returns all rows from the left table and matches from the right; unmatched right side is null. "
            "RIGHT JOIN does the opposite. FULL OUTER JOIN returns all rows from both tables, with nulls where there is no match. "
            "Use JOIN with ON to specify the join condition, often equality on a foreign key."
        ),
        "start_time": 32.0,
        "end_time": 48.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 3,
        "text": (
            "Indexing speeds up queries. A primary index is built on the table's primary key; data is stored in key order. "
            "Secondary indexes are on non-key attributes. B-trees are self-balancing trees used for indexes; keys and data can live in internal and leaf nodes. "
            "B-plus trees store data only in leaf nodes, with leaves linked for efficient range queries. "
            "Most databases use B-plus trees for indexing."
        ),
        "start_time": 48.0,
        "end_time": 65.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 4,
        "text": (
            "Concurrency control handles multiple transactions at once. Problems include dirty reads—reading uncommitted data from another transaction— "
            "lost updates when two transactions overwrite each other, and phantom reads where rows appear or disappear. "
            "Serializability means concurrent execution is equivalent to some serial order. "
            "Two-phase locking has a growing phase where you acquire locks and a shrinking phase where you release them; no new locks after release."
        ),
        "start_time": 65.0,
        "end_time": 82.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 5,
        "text": (
            "Hash indexes use a hash function to map keys to buckets. Lookup is O(1) on average for equality checks. "
            "Hash indexes are excellent for point lookups but cannot support range queries or ordering. "
            "Collision handling: chaining links items in the same bucket; open addressing finds another slot. "
            "Use hash indexes when you only need exact-match queries, not ranges or sorts."
        ),
        "start_time": 82.0,
        "end_time": 95.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 6,
        "text": (
            "Query optimization turns a logical query plan into an efficient physical plan. "
            "The optimizer considers costs: sequential vs index scan, join order, and operator choices. "
            "Nested loop join works well when one table is small; hash join when both fit in memory; merge sort join when data is sorted. "
            "EXPLAIN shows the chosen plan; use it to find missing indexes or expensive operations."
        ),
        "start_time": 95.0,
        "end_time": 112.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 7,
        "text": (
            "The CAP theorem says a distributed system cannot have all three: Consistency, Availability, and Partition tolerance. "
            "You must choose two when a network partition occurs. CP systems prefer consistency and may reject writes during partitions. "
            "AP systems stay available but may return stale data. Most real systems choose AP with eventual consistency. "
            "BASE—Basically Available, Soft state, Eventual consistency—is the counterpart to ACID for distributed stores."
        ),
        "start_time": 112.0,
        "end_time": 128.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 8,
        "text": (
            "NoSQL databases trade ACID guarantees for flexibility and horizontal scalability. "
            "Document stores like MongoDB store JSON-like documents; good for varying schemas. "
            "Key-value stores are the simplest: get and set by key. Column-family stores group columns for analytics. "
            "Graph databases model nodes and edges; ideal for social networks, recommendations, and traversal queries."
        ),
        "start_time": 128.0,
        "end_time": 142.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 9,
        "text": (
            "Caching reduces load on the primary data store. Redis is an in-memory key-value store often used as a cache. "
            "Cache-aside: the app checks the cache first; on miss, it loads from DB and populates the cache. "
            "Write-through: writes go to cache and DB together. Write-behind buffers writes and flushes asynchronously. "
            "Eviction policies: LRU, LFU, FIFO. Set a TTL to expire stale entries automatically."
        ),
        "start_time": 142.0,
        "end_time": 158.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 10,
        "text": (
            "Deadlock occurs when two or more transactions wait for each other to release locks. "
            "Example: T1 holds lock on A and waits for B; T2 holds lock on B and waits for A. "
            "Prevention: order resources and acquire locks in that order to avoid circular wait. "
            "Detection: build a wait-for graph; a cycle means deadlock. Resolution: abort one transaction to break the cycle."
        ),
        "start_time": 158.0,
        "end_time": 172.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 11,
        "text": (
            "Triggers are procedures that run automatically when certain events occur: INSERT, UPDATE, DELETE. "
            "Use triggers for audit logs, maintaining derived data, or enforcing complex business rules. "
            "Stored procedures are SQL code stored in the database and invoked by name. They reduce network round-trips. "
            "Both can improve consistency but add hidden logic; document them and use sparingly."
        ),
        "start_time": 172.0,
        "end_time": 188.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 12,
        "text": (
            "A data warehouse stores historical data for analytics and reporting, separate from the transactional OLTP system. "
            "OLAP—Online Analytical Processing—uses cube structures for multi-dimensional analysis. "
            "Star schema: one fact table with foreign keys to dimension tables. Snowflake schema normalizes dimensions. "
            "ETL—Extract, Transform, Load—moves and cleans data from sources into the warehouse."
        ),
        "start_time": 188.0,
        "end_time": 205.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 13,
        "text": (
            "Sharding splits data horizontally across multiple servers. Each shard holds a subset of rows. "
            "Shard key selection is critical: it determines how data is distributed and whether queries can be routed to one shard. "
            "Range-based sharding assigns contiguous key ranges; hash-based sharding distributes more evenly. "
            "Challenges: cross-shard joins are expensive, rebalancing when adding nodes, and maintaining global order."
        ),
        "start_time": 205.0,
        "end_time": 222.0,
    },
    {
        "meeting_id": "test-meeting-001",
        "chunk_index": 14,
        "text": (
            "Replication provides redundancy and read scalability. A primary accepts writes; replicas copy data and serve reads. "
            "Synchronous replication waits for replica ACK before committing; strong consistency but higher latency. "
            "Asynchronous replication commits locally and replicates in the background; lower latency but risk of data loss on failover. "
            "Leader election: when the primary fails, replicas run a consensus protocol like Raft to elect a new leader."
        ),
        "start_time": 222.0,
        "end_time": 238.0,
    },
]


def main():
    if not API_KEY:
        print("Set ELASTIC_API_KEY and run again.")
        return
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for chunk in TEST_CHUNKS:
        doc = {
            **chunk,
            "content": chunk["text"],
            "speaker_id": "instructor",
            "meeting_start_time": now,
            "received_at": now,
            "source": "zoom_agent",
        }
        resp = client.index(index=index_name, document=doc)
        print(f"Indexed chunk {chunk['chunk_index']}:", resp.get("result"), "id:", resp.get("_id"))
    print(f"Done. Indexed {len(TEST_CHUNKS)} chunks. Try queries: 'ACID properties', 'normalization 2NF 3NF', 'SQL joins', 'B-tree indexing', 'concurrency two-phase locking', 'hash index', 'query optimization EXPLAIN', 'CAP theorem', 'NoSQL MongoDB', 'Redis caching', 'deadlock', 'triggers stored procedures', 'data warehouse OLAP', 'sharding horizontal scaling', 'replication Raft'.")


if __name__ == "__main__":
    main()
