"""
Concept Card Agent — Fetch.ai uAgent.

Responsibilities:
1. detect_concept_completion — polls periodically; fetches current transcript,
   compares with previous state, identifies when a concept is completed (topic boundary).
2. create_concept_card — takes a completed segment, extracts title/short_explain/example
   via LLM, indexes to ta-da-concept-cards.

Flow: detect_concept_completion runs on schedule → on topic boundary → create_concept_card.
"""

import logging
import re
import sys
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)

from config import get_config


def create_text_chat(text: str) -> ChatMessage:
    """Create a ChatMessage with TextContent for sending replies."""
    return ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=text)],
    )
from elastic_client import ElasticClient
from llm_client import LLMClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("concept_card_agent")

config = get_config()

# uAgent
agent = Agent(
    name="concept-card-agent",
    seed=config.agent.seed or "concept_card_agent_seed_phrase_replace_in_production",
    port=config.agent.port,
    mailbox=True,
    publish_agent_details=True,
    readme_path="concept_card_agent_README.md",
)

# Clients (lazy init)
_elastic: ElasticClient | None = None
_llm: LLMClient | None = None


def get_elastic() -> ElasticClient:
    global _elastic
    if _elastic is None:
        _elastic = ElasticClient(config.elastic.url, config.elastic.api_key)
    return _elastic


def get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        _llm = LLMClient(
            config.llm.api_key,
            model=config.llm.model,
            base_url=config.llm.base_url or None,
        )
    return _llm


def _slug(text: str, max_len: int = 64) -> str:
    """Generate a slug from text for concept_id."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")
    return s[:max_len] if s else "unknown"


def _chunks_to_text(chunks: list[dict[str, Any]]) -> str:
    """Concatenate chunk text for LLM input."""
    return "\n\n".join(
        c.get("text", "").strip() for c in sorted(chunks, key=lambda x: x.get("chunk_index", 0))
    )


def create_concept_card(
    meeting_id: str,
    segment_chunks: list[dict[str, Any]],
    concept_id: str | None = None,
) -> str | None:
    """
    Tool: create_concept_card.
    Takes a completed concept segment, extracts title/short_explain/example via LLM,
    indexes to ta-da-concept-cards.
    Returns document ID or None on failure.
    """
    if not segment_chunks:
        logger.warning("create_concept_card: empty segment_chunks")
        return None
    try:
        es = get_elastic()
        llm = get_llm()
    except RuntimeError as e:
        logger.error("create_concept_card: %s", e)
        return None

    segment_text = _chunks_to_text(segment_chunks)
    if not segment_text.strip():
        logger.warning("create_concept_card: segment text empty")
        return None

    try:
        extracted = llm.extract_concept(segment_text)
    except Exception as e:
        logger.error("create_concept_card: LLM extract failed: %s", e)
        return None

    title = extracted.get("title", "Untitled Concept")
    short_explain = extracted.get("short_explain", "")
    example = extracted.get("example", "")

    if not concept_id:
        concept_id = f"segment_{segment_chunks[0].get('chunk_index', 0)}_{segment_chunks[-1].get('chunk_index', 0)}"
        # Prefer slug from title for readability
        slug = _slug(title)
        if slug and slug != "unknown":
            concept_id = slug

    try:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        doc_id = es.index_concept_card(
            meeting_id=meeting_id,
            concept_id=concept_id,
            title=title,
            short_explain=short_explain,
            example=example,
            timestamp=now,
        )
        logger.info("create_concept_card: indexed %s for meeting %s", doc_id, meeting_id)
        return doc_id
    except Exception as e:
        logger.error("create_concept_card: index failed: %s", e)
        return None


def detect_concept_completion(ctx: Context) -> None:
    """
    Tool: detect_concept_completion.
    Fetches current transcript for active sessions, compares with previous state,
    identifies when a concept is completed (topic boundary). If detected,
    calls create_concept_card for the completed segment.
    """
    try:
        es = get_elastic()
        llm = get_llm()
    except RuntimeError as e:
        ctx.logger.warning("detect_concept_completion: %s", e)
        return

    meetings = es.get_active_meetings()
    if not meetings:
        ctx.logger.debug("detect_concept_completion: no active meetings")
        return

    for m in meetings:
        meeting_id = m.get("meeting_id")
        if not meeting_id:
            continue

        try:
            _run_detection_for_meeting(ctx, es, llm, meeting_id)
        except Exception as e:
            ctx.logger.error("detect_concept_completion meeting %s: %s", meeting_id, e)


def _run_detection_for_meeting(
    ctx: Context,
    es: ElasticClient,
    llm: LLMClient,
    meeting_id: str,
) -> None:
    """Run topic boundary detection for one meeting."""
    # Fetch recent chunks
    chunks = es.fetch_all_chunks_for_meeting(meeting_id, limit=100)
    if len(chunks) < 2:
        ctx.logger.debug("detect_concept_completion: meeting %s has < 2 chunks", meeting_id)
        return

    state = es.load_agent_state(meeting_id)
    last_chunk_index = -1 if not state else state.get("last_chunk_index", -1)
    last_topic_summary = "" if not state else state.get("last_topic_summary", "")

    # Split into "previous" (already seen) and "current" (new since last run)
    previous_chunks = [c for c in chunks if c.get("chunk_index", 0) <= last_chunk_index]
    current_chunks = [c for c in chunks if c.get("chunk_index", 0) > last_chunk_index]

    if not current_chunks:
        ctx.logger.debug("detect_concept_completion: no new chunks for meeting %s", meeting_id)
        return

    # Need at least some previous context to compare
    previous_text = _chunks_to_text(previous_chunks) if previous_chunks else last_topic_summary
    current_text = _chunks_to_text(current_chunks)

    if not previous_text.strip():
        # First run: no previous context, just save state
        max_idx = max(c.get("chunk_index", 0) for c in current_chunks)
        es.save_agent_state(
            meeting_id=meeting_id,
            last_chunk_index=max_idx,
            last_topic_summary=current_text[:2000],
        )
        ctx.logger.debug("detect_concept_completion: initial state saved for meeting %s", meeting_id)
        return

    try:
        result = llm.compare_topics(previous_text[:4000], current_text[:4000])
    except Exception as e:
        ctx.logger.error("detect_concept_completion: LLM compare failed: %s", e)
        return

    is_boundary = result.get("is_topic_boundary", False)
    new_concept_hint = result.get("new_concept_hint") or ""

    if is_boundary and previous_chunks:
        # Previous concept completed — create card for previous segment
        concept_id = _slug(new_concept_hint) if new_concept_hint else None
        create_concept_card(
            meeting_id=meeting_id,
            segment_chunks=previous_chunks,
            concept_id=concept_id,
        )

    # Save state for next run
    max_idx = max(c.get("chunk_index", 0) for c in chunks)
    es.save_agent_state(
        meeting_id=meeting_id,
        last_chunk_index=max_idx,
        last_topic_summary=current_text[:2000],
    )


# Chat Protocol (GigMart-style)
chat_proto = Protocol(spec=chat_protocol_spec)


def _extract_text_from_message(msg: ChatMessage) -> str:
    """Extract plain text from ChatMessage content."""
    parts = []
    for item in msg.content:
        if hasattr(item, "text"):
            parts.append(getattr(item, "text", "") or "")
    return " ".join(parts).strip()


@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    """Handle incoming chat messages."""
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )
    user_text = _extract_text_from_message(msg)
    if not user_text:
        user_text = "(empty message)"
    ctx.logger.info("Chat from %s: %s", sender[:16] + "...", user_text[:80])
    response = (
        "I'm the Concept Card Agent. I detect when lecture concepts are completed "
        "and create concept cards from transcripts. You can ask me to run detection "
        "or create a card, or just chat."
    )
    await ctx.send(sender, create_text_chat(response))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    """Handle acknowledgements (required by protocol)."""
    ctx.logger.debug(
        "Received acknowledgement from %s for message %s",
        sender[:16] + "...",
        msg.acknowledged_msg_id,
    )


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    logger.info("Starting Concept Card Agent (port=%s, poll_interval=%ss)", config.agent.port, config.agent.poll_interval_sec)
    agent.run()
