"""
Elasticsearch client for the Concept Card Agent.
- Fetch recent transcript chunks from ta-da-latest
- Load/save per-session state for topic comparison
- Index concept cards to ta-da-concept-cards
"""

from datetime import datetime, timezone
from typing import Any

from elasticsearch import Elasticsearch

INDEX_TA_DA_LATEST = "ta-da-latest"
INDEX_CONCEPT_CARDS = "ta-da-concept-cards"
INDEX_SESSIONS = "ta-da-sessions"
INDEX_AGENT_STATE = "ta-da-concept-card-agent-state"


class ElasticClient:
    def __init__(self, url: str, api_key: str):
        self.client = Elasticsearch(url, api_key=api_key) if api_key else None

    def _ensure_client(self):
        if not self.client:
            raise RuntimeError("Elasticsearch client not configured (ELASTIC_API_KEY required)")

    def fetch_recent_chunks(
        self,
        meeting_id: str,
        limit: int = 50,
        after_chunk_index: int | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch transcript chunks from ta-da-latest, ordered by chunk_index asc."""
        self._ensure_client()
        query: dict[str, Any] = {"bool": {"filter": [{"term": {"meeting_id": meeting_id}}]}}
        if after_chunk_index is not None:
            query["bool"]["filter"].append(
                {"range": {"chunk_index": {"gt": after_chunk_index}}}
            )
        resp = self.client.search(
            index=INDEX_TA_DA_LATEST,
            query=query,
            sort=[{"chunk_index": "asc"}],
            size=limit,
            source_excludes=[],
        )
        hits = resp.get("hits", {}).get("hits", [])
        return [{"_id": h["_id"], **h.get("_source", {})} for h in hits]

    def fetch_all_chunks_for_meeting(
        self, meeting_id: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Fetch all chunks for a meeting, ordered by chunk_index asc."""
        return self.fetch_recent_chunks(meeting_id, limit=limit, after_chunk_index=None)

    def get_active_meetings(self) -> list[dict[str, Any]]:
        """Get meetings from ta-da-sessions (meeting_id)."""
        self._ensure_client()
        resp = self.client.search(
            index=INDEX_SESSIONS,
            query={"match_all": {}},
            size=100,
            _source=["meeting_id"],
        )
        hits = resp.get("hits", {}).get("hits", [])
        return [h.get("_source", {}) for h in hits]

    def get_latest_meeting_id(self) -> str | None:
        """Get the latest meeting_id by fetching the most recent chunk from ta-da-latest."""
        self._ensure_client()
        resp = self.client.search(
            index=INDEX_TA_DA_LATEST,
            query={"match_all": {}},
            size=1,
            sort=[{"received_at": "desc"}],
            _source=["meeting_id"],
        )
        hits = resp.get("hits", {}).get("hits", [])
        if not hits:
            return None
        return hits[0].get("_source", {}).get("meeting_id")

    def fetch_all_chunks(self, limit: int = 1000) -> list[dict[str, Any]]:
        """Fetch all chunks from ta-da-latest (across all meetings), ordered by chunk_index."""
        self._ensure_client()
        resp = self.client.search(
            index=INDEX_TA_DA_LATEST,
            query={"match_all": {}},
            size=limit,
            sort=[{"meeting_id": "asc"}, {"chunk_index": "asc"}],
            _source_excludes=[],
        )
        hits = resp.get("hits", {}).get("hits", [])
        return [{"_id": h["_id"], **h.get("_source", {})} for h in hits]

    def load_agent_state(self, meeting_id: str) -> dict[str, Any] | None:
        """Load per-meeting state: last_chunk_index, last_topic_summary."""
        self._ensure_client()
        try:
            doc = self.client.get(index=INDEX_AGENT_STATE, id=meeting_id)
            return doc.get("_source", {})
        except Exception:
            return None

    def save_agent_state(
        self,
        meeting_id: str,
        last_chunk_index: int,
        last_topic_summary: str,
    ) -> None:
        """Save per-meeting state for next comparison."""
        self._ensure_client()
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        doc = {
            "meeting_id": meeting_id,
            "last_chunk_index": last_chunk_index,
            "last_topic_summary": last_topic_summary,
            "updated_at": now,
        }
        self.client.index(index=INDEX_AGENT_STATE, id=meeting_id, document=doc)

    def index_concept_card(
        self,
        meeting_id: str,
        concept_id: str,
        title: str,
        short_explain: str,
        example: str,
        timestamp: str | None = None,
    ) -> str:
        """Index a concept card to ta-da-concept-cards. Returns document ID."""
        self._ensure_client()
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        doc = {
            "meeting_id": meeting_id,
            "concept_id": concept_id,
            "title": title,
            "short_explain": short_explain,
            "example": example,
            "timestamp": timestamp or now,
        }
        doc_id = f"{meeting_id}_{concept_id}"
        self.client.index(index=INDEX_CONCEPT_CARDS, id=doc_id, document=doc)
        return doc_id
