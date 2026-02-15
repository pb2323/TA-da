"""
Redis client for the Concept Card Agent.
Tracks the last processed chunk index per meeting for incremental concept card creation.
"""

from typing import Optional
import redis


class RedisClient:
    def __init__(self, url: str, db: int = 0):
        """Initialize Redis client. Set url to empty string to disable Redis."""
        self.client = redis.from_url(url, db=db, decode_responses=True) if url else None

    def _ensure_client(self):
        if not self.client:
            raise RuntimeError("Redis client not configured (REDIS_URL required)")

    def get_last_chunk_index(self, meeting_id: str) -> int:
        """
        Get the last processed chunk index for a meeting.
        Returns -1 if no state exists (meaning all chunks are new).
        """
        self._ensure_client()
        key = f"concept_cards:last_chunk:{meeting_id}"
        value = self.client.get(key)
        return int(value) if value is not None else -1

    def set_last_chunk_index(self, meeting_id: str, chunk_index: int, ttl: Optional[int] = None):
        """
        Set the last processed chunk index for a meeting.
        
        Args:
            meeting_id: Meeting identifier
            chunk_index: Last chunk index that was processed
            ttl: Optional TTL in seconds (e.g. 86400 for 24h, 604800 for 7 days)
        """
        self._ensure_client()
        key = f"concept_cards:last_chunk:{meeting_id}"
        self.client.set(key, chunk_index)
        if ttl:
            self.client.expire(key, ttl)

    def reset_last_chunk_index(self, meeting_id: str):
        """Delete the last chunk index for a meeting (force reprocess all chunks)."""
        self._ensure_client()
        key = f"concept_cards:last_chunk:{meeting_id}"
        self.client.delete(key)

    def ping(self) -> bool:
        """Check if Redis is reachable. Returns True if connected, False otherwise."""
        if not self.client:
            return False
        try:
            return self.client.ping()
        except Exception:
            return False

    def is_paused(self) -> bool:
        """Check if automatic concept card generation is paused globally."""
        self._ensure_client()
        key = "concept_cards:paused"
        return self.client.get(key) == "1"

    def pause(self):
        """Pause automatic concept card generation."""
        self._ensure_client()
        key = "concept_cards:paused"
        self.client.set(key, "1")

    def resume(self):
        """Resume automatic concept card generation."""
        self._ensure_client()
        key = "concept_cards:paused"
        self.client.delete(key)
