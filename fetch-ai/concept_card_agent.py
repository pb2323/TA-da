"""
Concept Card Agent — Fetch.ai uAgent.

Responsibilities:
1. detect_concept_completion — polls periodically; fetches current transcript,
   compares with previous state, identifies when a concept is completed (topic boundary).
2. create_concept_card — takes a completed segment, extracts title/short_explain/example
   via LLM, indexes to ta-da-concept-cards.

Flow: detect_concept_completion runs on schedule → on topic boundary → create_concept_card.
"""

import json
import logging
import re
import sys
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import requests
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
from redis_client import RedisClient

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
    seed=config.agent.seed or "concept_card_agent_seed_phrase_replace_in_production_v1",
    port=config.agent.port,
    mailbox=True,
    publish_agent_details=True,
    readme_path="concept_card_agent_README.md",
)

# Clients (lazy init)
_elastic: ElasticClient | None = None
_llm: LLMClient | None = None
_redis: RedisClient | None = None


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


def get_redis() -> RedisClient:
    global _redis
    if _redis is None:
        _redis = RedisClient(config.redis.url, config.redis.db)
    return _redis


def _slug(text: str, max_len: int = 64) -> str:
    """Generate a slug from text for concept_id."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")
    return s[:max_len] if s else "unknown"


def _chunks_to_text(chunks: list[dict[str, Any]]) -> str:
    """Concatenate chunk text for LLM input."""
    return "\n\n".join(
        c.get("text", "").strip() for c in sorted(chunks, key=lambda x: x.get("chunk_index", 0))
    )


def call_backend_agent_converse(input_text: str, agent_id: str = "tada-agent") -> dict[str, Any]:
    """
    Call backend /agent/converse API to get summary from Elastic Agent Builder.
    Returns dict with 'success', 'message', and optionally 'data' (API response).
    """
    backend_url = config.backend.url.rstrip("/")
    if not backend_url or backend_url == "http://localhost:3000":
        return {
            "success": False,
            "message": "Backend URL not configured. Set RENDER_BACKEND_URL in .env.local",
        }

    try:
        url = f"{backend_url}/agent/converse"
        payload = {"input": input_text.strip(), "agent_id": agent_id}
        
        logger.info("Calling backend agent/converse: %s", url)
        resp = requests.post(url, json=payload, timeout=60)
        
        if not resp.ok:
            error_data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            error_msg = error_data.get("error", f"HTTP {resp.status_code}")
            logger.error("Backend agent/converse failed: %s", error_msg)
            return {
                "success": False,
                "message": f"Backend API error: {error_msg}",
            }
        
        data = resp.json()
        return {
            "success": True,
            "message": "Summary retrieved successfully",
            "data": data,
        }
    except requests.exceptions.Timeout:
        logger.error("Backend agent/converse timeout")
        return {
            "success": False,
            "message": "Backend API timeout (30s). Try again later.",
        }
    except Exception as e:
        logger.error("Backend agent/converse exception: %s", e)
        return {
            "success": False,
            "message": f"Error calling backend: {e}",
        }


def _extract_message_only(obj: Any) -> str | None:
    """
    Extract only the human-readable message string from an API response.
    Ignores all metadata (tool_result_id, model_usage, references, etc.).
    Handles nested structures like { "response": { "message": "..." } }.
    """
    if obj is None:
        return None
    if isinstance(obj, str) and obj.strip():
        return obj.strip()
    if isinstance(obj, dict):
        # Prefer message-like keys that typically hold the final summary
        for key in ("message", "content", "text", "output", "result", "summary"):
            val = obj.get(key)
            if val is None:
                continue
            if isinstance(val, str) and val.strip():
                return val.strip()
            if isinstance(val, dict):
                out = _extract_message_only(val)
                if out:
                    return out
            if isinstance(val, list):
                # Sometimes content is a list of parts; take the last text part
                for item in reversed(val):
                    if isinstance(item, dict):
                        out = _extract_message_only(item)
                        if out:
                            return out
                    if isinstance(item, str) and item.strip():
                        return item.strip()
        # Recurse into "response" if it's a dict (Elastic Agent Builder shape)
        resp = obj.get("response")
        if isinstance(resp, dict):
            out = _extract_message_only(resp)
            if out:
                return out
        if isinstance(resp, str) and resp.strip():
            return resp.strip()
    if isinstance(obj, list):
        for item in reversed(obj):  # Often the last item is the final message
            out = _extract_message_only(item)
            if out:
                return out
    return None


def _format_summary_markdown(text: str) -> str:
    """
    Normalize summary text for consistent markdown: decode Unicode escapes,
    ensure numbered sections are headings, and normalize spacing.
    """
    if not text or not isinstance(text, str):
        return text
    
    # Replace literal \uXXXX with actual Unicode character (e.g. \u2013 -> en dash)
    def replace_unicode_escape(match: re.Match) -> str:
        return chr(int(match.group(1), 16))
    text = re.sub(r"\\u([0-9a-fA-F]{4})", replace_unicode_escape, text)
    
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Numbered section line (e.g. "1. ACID Properties" or "1. ACID Properties in Databases")
        if re.match(r"^\d+\.\s+.+", stripped) and len(stripped) < 120:
            # Ensure it's a markdown heading for consistent formatting
            if not stripped.startswith("##"):
                stripped = "## " + stripped
            out.append("")
            out.append(stripped)
            out.append("")
            i += 1
            continue
        
        # Existing markdown heading (# or ##) - keep, ensure blank line before
        if re.match(r"^#{1,6}\s", stripped):
            if out and out[-1] != "":
                out.append("")
            out.append(stripped)
            out.append("")
            i += 1
            continue
        
        # Bullet line (- or *) - keep as-is, ensure single line before if needed
        if stripped.startswith("- ") or stripped.startswith("* "):
            if out and out[-1] != "" and not (out[-1].strip().startswith("- ") or out[-1].strip().startswith("* ")):
                out.append("")
            out.append(line)
            i += 1
            continue
        
        # Plain paragraph: keep but ensure it's not squashed into heading (blank after)
        if stripped:
            out.append(line)
            # If next line is a numbered section or heading, add blank
            if i + 1 < len(lines):
                next_s = lines[i + 1].strip()
                if re.match(r"^\d+\.\s+", next_s) or re.match(r"^#{1,6}\s", next_s):
                    out.append("")
        else:
            # Preserve single blank (collapse multiple blanks to one)
            if out and out[-1] != "":
                out.append("")
        i += 1
    
    result = "\n".join(out).strip()
    # Collapse 3+ newlines to 2
    while "\n\n\n" in result:
        result = result.replace("\n\n\n", "\n\n")
    return result


def create_concept_card(
    meeting_id: str,
    segment_chunks: list[dict[str, Any]],
    concept_id: str | None = None,
) -> dict[str, Any] | None:
    """
    Tool: create_concept_card.
    Takes a completed concept segment, extracts title/short_explain/example via LLM,
    indexes to ta-da-concept-cards.
    Returns dict with doc_id, concept_id, title, short_explain, example; or None on failure.
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
        return {
            "doc_id": doc_id,
            "concept_id": concept_id,
            "title": title,
            "short_explain": short_explain,
            "example": example,
        }
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


def _process_concept_cards_for_meeting(
    es: ElasticClient,
    llm: LLMClient,
    redis: RedisClient | None,
    meeting_id: str,
    log_prefix: str = "",
) -> dict[str, Any]:
    """
    Core logic: process new chunks for a meeting and create concept cards.
    Returns dict with: success, message, cards_created, chunks_processed, chunk_range
    """
    result = {
        "success": False,
        "message": "",
        "cards_created": 0,
        "chunks_processed": 0,
        "chunk_range": "",
        "created_cards": [],
    }

    # Get last processed chunk index from Redis
    last_chunk_index = -1
    if redis:
        try:
            last_chunk_index = redis.get_last_chunk_index(meeting_id)
            logger.info("%s: last processed chunk_index=%d", log_prefix, last_chunk_index)
        except Exception as e:
            logger.warning("%s: Redis read failed, using -1: %s", log_prefix, e)
            last_chunk_index = -1

    # Fetch all chunks for that meeting
    try:
        all_chunks = es.fetch_all_chunks_for_meeting(meeting_id, limit=1000)
        if not all_chunks:
            result["message"] = f"No chunks found for meeting {meeting_id}."
            return result
    except Exception as e:
        logger.error("%s: fetch chunks failed: %s", log_prefix, e)
        result["message"] = f"Error fetching chunks: {e}"
        return result

    # Filter to only new chunks (chunk_index > last_chunk_index)
    new_chunks = [c for c in all_chunks if c.get("chunk_index", 0) > last_chunk_index]
    
    if not new_chunks:
        result["success"] = True
        result["message"] = f"No new chunks to process for meeting `{meeting_id}`. Last processed: chunk {last_chunk_index}."
        return result

    logger.info("%s: fetched %d total chunks, %d new chunks", log_prefix, len(all_chunks), len(new_chunks))
    result["chunks_processed"] = len(new_chunks)

    # Identify segment boundaries (only on new chunks)
    try:
        segments = llm.identify_segment_boundaries(new_chunks)
        if not segments:
            # No segments detected, but update Redis to mark these chunks as processed
            max_new_idx = max(c.get("chunk_index", 0) for c in new_chunks)
            if redis:
                redis.set_last_chunk_index(meeting_id, max_new_idx, ttl=604800)  # 7 days TTL
            result["success"] = True
            result["message"] = f"No concept segments detected in the {len(new_chunks)} new chunk(s) for meeting `{meeting_id}`."
            result["chunk_range"] = f"{last_chunk_index + 1} to {max_new_idx}"
            return result
    except Exception as e:
        logger.error("%s: segment detection failed: %s", log_prefix, e)
        result["message"] = f"Error detecting segments: {e}"
        return result

    logger.info("%s: found %d segments in new chunks", log_prefix, len(segments))

    # Create concept cards for each segment
    created_cards: list[dict[str, Any]] = []
    for seg in segments:
        start_idx = seg.get("start_chunk", 0)
        end_idx = seg.get("end_chunk", 0)
        concept_hint = seg.get("concept_hint", "")
        segment_chunks = [
            c for c in new_chunks if start_idx <= c.get("chunk_index", 0) <= end_idx
        ]
        if not segment_chunks:
            continue
        concept_id = _slug(concept_hint) if concept_hint else None
        card = create_concept_card(
            meeting_id=meeting_id,
            segment_chunks=segment_chunks,
            concept_id=concept_id,
        )
        if card:
            created_cards.append(card)
            logger.info(
                "%s: created card %s (%s)",
                log_prefix,
                card["doc_id"],
                concept_hint,
            )

    # Update Redis with new last processed chunk index
    max_new_idx = max(c.get("chunk_index", 0) for c in new_chunks)
    if redis:
        try:
            redis.set_last_chunk_index(meeting_id, max_new_idx, ttl=604800)  # 7 days TTL
            logger.info("%s: updated Redis last_chunk_index to %d", log_prefix, max_new_idx)
        except Exception as e:
            logger.warning("%s: Redis write failed: %s", log_prefix, e)

    result["success"] = True
    result["cards_created"] = len(created_cards)
    result["created_cards"] = created_cards
    result["chunk_range"] = f"{last_chunk_index + 1} to {max_new_idx}"
    
    if not created_cards:
        result["message"] = f"Processed {len(new_chunks)} new chunk(s) but no concept cards were created for meeting `{meeting_id}`."
    else:
        result["message"] = f"Created {len(created_cards)} concept cards from {len(new_chunks)} new chunk(s) for meeting `{meeting_id}`."
    
    return result


def run_manual_concept_card_creation(ctx: Context) -> str:
    """
    Manual tool: create concept cards for the latest meeting.
    Uses Redis to track last processed chunk and only processes new chunks incrementally.
    """
    try:
        es = get_elastic()
        llm = get_llm()
        redis = get_redis()
    except RuntimeError as e:
        logger.error("run_manual_concept_card_creation: %s", e)
        return f"Error: {e}"

    # Check Redis connectivity
    if not redis.ping():
        logger.warning("run_manual_concept_card_creation: Redis not available, falling back to full reprocess")
        redis = None

    # Get latest meeting_id
    try:
        meeting_id = es.get_latest_meeting_id()
        if not meeting_id:
            return "No chunks found in ta-da-latest. Index some transcript chunks first."
    except Exception as e:
        logger.error("run_manual_concept_card_creation: get_latest_meeting_id failed: %s", e)
        return f"Error fetching latest meeting: {e}"

    ctx.logger.info("run_manual_concept_card_creation: latest meeting_id=%s", meeting_id)

    # Process concept cards using core logic
    result = _process_concept_cards_for_meeting(
        es, llm, redis, meeting_id, log_prefix="run_manual_concept_card_creation"
    )

    # Format response for chat
    if not result["success"] or result["cards_created"] == 0:
        return result["message"]
    
    lines = [
        f"Created **{result['cards_created']}** concept cards from **{result['chunks_processed']}** new chunk(s) for meeting `{meeting_id}`.",
        f"_(Processed chunks {result['chunk_range']})_",
        "",
        "---",
        "",
    ]
    for i, c in enumerate(result["created_cards"], 1):
        title = c.get("title", "Untitled")
        short = c.get("short_explain", "").strip()
        ex = c.get("example", "").strip()
        lines.append(f"### {i}. {title}")
        if short:
            lines.append(f"{short}")
        if ex:
            lines.append(f"*Example:* {ex}")
        lines.append("")
    return "\n".join(lines).strip()


@agent.on_interval(period=config.agent.auto_run_interval_sec)
async def auto_create_concept_cards(ctx: Context):
    """
    Automatic concept card creation: runs every N seconds (configurable via CONCEPT_CARD_AUTO_RUN_INTERVAL).
    Processes new chunks for the latest meeting if not paused.
    """
    try:
        redis = get_redis()
        
        # Check if paused
        if redis and redis.ping() and redis.is_paused():
            ctx.logger.debug("auto_create_concept_cards: paused, skipping")
            return
        
        es = get_elastic()
        llm = get_llm()
    except RuntimeError as e:
        logger.error("auto_create_concept_cards: %s", e)
        return

    # Check Redis connectivity
    if not redis or not redis.ping():
        logger.warning("auto_create_concept_cards: Redis not available, skipping auto-run")
        return

    # Get latest meeting_id
    try:
        meeting_id = es.get_latest_meeting_id()
        if not meeting_id:
            ctx.logger.debug("auto_create_concept_cards: no chunks in ta-da-latest")
            return
    except Exception as e:
        logger.error("auto_create_concept_cards: get_latest_meeting_id failed: %s", e)
        return

    ctx.logger.info("auto_create_concept_cards: processing meeting_id=%s", meeting_id)

    # Process concept cards using core logic
    result = _process_concept_cards_for_meeting(
        es, llm, redis, meeting_id, log_prefix="auto_create_concept_cards"
    )

    if result["success"] and result["cards_created"] > 0:
        ctx.logger.info(
            "auto_create_concept_cards: created %d cards from %d new chunks (%s)",
            result["cards_created"],
            result["chunks_processed"],
            result["chunk_range"],
        )
    elif not result["success"]:
        ctx.logger.warning("auto_create_concept_cards: %s", result["message"])


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
    
    lower = user_text.lower()
    
    # Pause command
    if any(kw in lower for kw in ["pause", "stop auto", "disable auto"]):
        try:
            redis = get_redis()
            if redis and redis.ping():
                redis.pause()
                response = "✅ Automatic concept card generation **paused**. Manual triggers still work. Say 'resume' to restart."
            else:
                response = "⚠️ Redis not available. Cannot pause automatic generation."
        except Exception as e:
            logger.error("pause command failed: %s", e)
            response = f"❌ Error pausing: {e}"
        await ctx.send(sender, create_text_chat(response))
        return
    
    # Resume command
    if any(kw in lower for kw in ["resume", "start auto", "enable auto", "unpause"]):
        try:
            redis = get_redis()
            if redis and redis.ping():
                redis.resume()
                response = f"✅ Automatic concept card generation **resumed**. Running every {config.agent.auto_run_interval_sec}s."
            else:
                response = "⚠️ Redis not available. Cannot resume automatic generation."
        except Exception as e:
            logger.error("resume command failed: %s", e)
            response = f"❌ Error resuming: {e}"
        await ctx.send(sender, create_text_chat(response))
        return
    
    # Status command
    if any(kw in lower for kw in ["status", "is paused", "auto status"]):
        try:
            redis = get_redis()
            if redis and redis.ping():
                paused = redis.is_paused()
                status = "⏸️ **PAUSED**" if paused else f"▶️ **RUNNING** (every {config.agent.auto_run_interval_sec}s)"
                response = f"Automatic concept card generation: {status}"
            else:
                response = "⚠️ Redis not available. Automatic generation is disabled."
        except Exception as e:
            logger.error("status command failed: %s", e)
            response = f"❌ Error checking status: {e}"
        await ctx.send(sender, create_text_chat(response))
        return
    
    # Summary command - call backend agent
    if any(kw in lower for kw in ["summary", "catch up", "catchup", "what happened", "summarize"]):
        ctx.logger.info("Summary request triggered by chat")
        
        # Call backend agent/converse API
        result = call_backend_agent_converse(
            input_text="Give me a detailed summary of everything that has happened in the lecture so far, based on all the concept cards and transcript chunks available.",
            agent_id="tada-agent"
        )
        
        if not result["success"]:
            response = f"❌ {result['message']}"
            await ctx.send(sender, create_text_chat(response))
            return
        
        # Format the response from backend
        data = result.get("data", {})
        
        # Parse if backend returned a JSON string
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                data = {"message": data}
        
        # Extract only the final message string; ignore all metadata (tool_result_id, model_usage, etc.)
        agent_response = _extract_message_only(data)
        
        if not agent_response:
            agent_response = "No summary content could be extracted from the agent response."
        
        # Normalize newlines (literal \n -> real newline)
        agent_response = agent_response.replace("\\n", "\n").strip()
        
        # Normalize formatting for consistent markdown (headings, Unicode, spacing)
        agent_response = _format_summary_markdown(agent_response)
        
        response = (
            "📚 **Lecture Summary**\n\n"
            f"{agent_response}\n\n"
            "---\n"
            "_Summary generated by TA-DA Agent using Elastic Agent Builder_"
        )
        
        await ctx.send(sender, create_text_chat(response))
        return
    
    # Manual create command
    if any(kw in lower for kw in ["create concept card", "generate concept card", "run detection", "detect concept", "make card"]):
        ctx.logger.info("run_manual_concept_card_creation triggered by chat")
        response = run_manual_concept_card_creation(ctx)
        await ctx.send(sender, create_text_chat(response))
        return
    
    # Default/help response
    response = (
        "I'm the Concept Card Agent. I automatically create concept cards from lecture transcripts.\n\n"
        "**Commands:**\n"
        "• `create concept cards` — Manually process new chunks\n"
        "• `summary` / `catch up` — Get a summary of everything covered\n"
        "• `pause` — Stop automatic processing\n"
        "• `resume` — Restart automatic processing\n"
        "• `status` — Check if auto-processing is running\n\n"
        f"Auto-processing runs every {config.agent.auto_run_interval_sec}s when not paused."
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
    logger.info(
        "Starting Concept Card Agent (port=%s, auto_run_interval=%ss)",
        config.agent.port,
        config.agent.auto_run_interval_sec,
    )
    agent.run()
