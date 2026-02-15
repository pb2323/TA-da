"""
LLM client for the Concept Card Agent.
- Topic comparison: given current and previous segments, detect if topic boundary
- Concept extraction: given a segment, extract title, short_explain, example
"""

import json
import re
from typing import Any

from openai import OpenAI

TOPIC_COMPARISON_SYSTEM = """You are an expert at analyzing lecture transcripts to detect when the instructor moves from one concept/topic to another.

Given two transcript segments (previous and current), output JSON:
- is_topic_boundary: true if the current segment clearly starts a NEW concept (topic shift); false otherwise
- new_concept_hint: if is_topic_boundary is true, a short phrase for the new concept (e.g. "SQL joins", "ACID properties"); otherwise null

Be conservative: only set is_topic_boundary=true when there is a clear shift (e.g. instructor says "Next we'll cover...", "Moving on to...", or content is clearly different topic).
Small elaborations or examples on the same concept should NOT be a boundary."""

CONCEPT_EXTRACTION_SYSTEM = """You are an expert at creating study aids from lecture transcripts.

Given a transcript segment that explains a single concept, output JSON:
- title: A short, clear title for the concept (3-8 words)
- short_explain: A concise explanation in 2-4 sentences, suitable for a flashcard
- example: One concrete example that illustrates the concept (1-2 sentences)

Output ONLY valid JSON, no other text."""

SEGMENT_BOUNDARIES_SYSTEM = """You are an expert at analyzing lecture transcripts and identifying topic boundaries.

Given a full lecture transcript (with chunk indices), identify where the instructor moves from one concept to another.

Output JSON with an array of segment boundaries:
- segments: array of objects, each with { "start_chunk": int, "end_chunk": int, "concept_hint": str }

Example: if chunks 0-2 cover ACID, 3-6 cover normalization, 7-10 cover SQL joins:
{
  "segments": [
    { "start_chunk": 0, "end_chunk": 2, "concept_hint": "ACID properties" },
    { "start_chunk": 3, "end_chunk": 6, "concept_hint": "Normalization" },
    { "start_chunk": 7, "end_chunk": 10, "concept_hint": "SQL joins" }
  ]
}

Be conservative: only create a new segment when there is a clear topic shift.
Output ONLY valid JSON, no other text."""


class LLMClient:
    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str | None = None,
    ):
        if not api_key:
            self.client = None
            self.model = model
            return
        kwargs: dict = {"api_key": api_key}
        if base_url and base_url.strip():
            kwargs["base_url"] = base_url.strip()
        self.client = OpenAI(**kwargs)
        self.model = model

    def _ensure_client(self):
        if not self.client:
            raise RuntimeError(
                "LLM client not configured. Set XAI_API_KEY (for xAI/Grok) or OPENAI_API_KEY in .env.local"
            )

    def compare_topics(
        self,
        previous_segment: str,
        current_segment: str,
    ) -> dict[str, Any]:
        """Compare segments and return { is_topic_boundary: bool, new_concept_hint?: str }."""
        self._ensure_client()
        user = f"""Previous segment:
{previous_segment}

Current segment:
{current_segment}

Output JSON: {{ "is_topic_boundary": bool, "new_concept_hint": str | null }}"""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": TOPIC_COMPARISON_SYSTEM},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
        )
        text = resp.choices[0].message.content
        return _parse_json(text)

    def extract_concept(self, segment_text: str) -> dict[str, str]:
        """Extract title, short_explain, example from a completed concept segment."""
        self._ensure_client()
        user = f"""Transcript segment:
{segment_text}

Output JSON: {{ "title": str, "short_explain": str, "example": str }}"""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": CONCEPT_EXTRACTION_SYSTEM},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
        )
        text = resp.choices[0].message.content
        return _parse_json(text)

    def identify_segment_boundaries(
        self,
        chunks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Given a list of chunks (with chunk_index and text), identify topic boundaries.
        Returns a list of segments: [{ start_chunk, end_chunk, concept_hint }, ...]
        """
        self._ensure_client()
        if not chunks:
            return []
        # Build transcript with chunk markers
        lines = []
        for c in sorted(chunks, key=lambda x: x.get("chunk_index", 0)):
            idx = c.get("chunk_index", 0)
            text = c.get("text", "").strip()
            lines.append(f"[Chunk {idx}]\n{text}")
        transcript = "\n\n".join(lines)
        user = f"""Full lecture transcript:

{transcript[:8000]}

Output JSON: {{ "segments": [ {{ "start_chunk": int, "end_chunk": int, "concept_hint": str }}, ... ] }}"""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SEGMENT_BOUNDARIES_SYSTEM},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
        )
        text = resp.choices[0].message.content
        result = _parse_json(text)
        return result.get("segments", [])


def _parse_json(text: str) -> dict[str, Any]:
    """Extract JSON from LLM response, handling markdown code blocks."""
    text = text.strip()
    # Remove markdown code block if present
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()
    return json.loads(text)
