# GigMart Agent Implementation Reference

This document summarizes the [GigMart](https://github.com/pb2323/GigMart) agent architecture so you can reuse patterns for TA-DA's `fetch-ai` implementation.

**Note:** GigMart uses **XAI Grok** (via OpenAI SDK) for NLU—**not LangChain**. The orchestration is custom.

---

## Architecture Overview

```
User (ASI-1) → Agent (uAgents) → OrchestrationManager → LLM (intent) + Direct API calls + State (Redis/Elastic)
```

**TA-DA:** No MCP server. Agents call Elasticsearch, backend APIs, and other services directly (HTTP/REST).

### Layer Summary

| Layer | Component | Purpose |
|-------|-----------|---------|
| **Agent** | `entrepreneur_agent.py`, `freelancer_agent.py` | Entry points, uAgents + Chat Protocol |
| **Orchestration** | `orchestration.py` | NL understanding, tool routing, multi-step workflows |
| **NLU** | `xai_client.py` | Intent + parameter extraction (XAI Grok) |
| **State** | `redis_manager.py` | Conversation state, rate limiting |
| **Config** | `config.py` | Pydantic-based env config |

*GigMart uses MCP for tools; TA-DA will call Elasticsearch and backend APIs directly.*

---

## 1. Agent Entry Points

### Pattern (both agents)

```python
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, TextContent,
    chat_protocol_spec, EndSessionContent
)

# 1. Create agent
agent = Agent(
    name="gigmart-entrepreneur",
    seed=os.getenv("AGENT_SEED_PHRASE"),
    port=8001,
    mailbox=True,
    publish_agent_details=True,
    readme_path="entrepreneur_README.md"
)

# 2. Wire chat protocol
chat_proto = Protocol(spec=chat_protocol_spec)

@chat_proto.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    # Acknowledge
    await ctx.send(sender, ChatAcknowledgement(...))
    # Extract text, check rate limit
    # Call orchestration_manager.process_user_input(user_text, sender_id, role)
    # Send response
    await ctx.send(sender, create_text_chat(response_text))

agent.include(chat_proto, publish_manifest=True)
agent.run()
```

### Differences between agents

- **Entrepreneur:** `AGENT_SEED_PHRASE`, port 8001, `role="entrepreneur"`, has fallback `search_freelancers()` for simple queries.
- **Freelancer:** `FREELANCER_AGENT_SEED`, port 8002, `role="freelancer"`.

### Dependencies (GigMart)

- `config.py` (get_config)
- `xai_client.py` (XAIClient)
- `redis_manager.py` (RedisManager)
- `orchestration.py` (OrchestrationManager)

*TA-DA: Replace MCP with direct Elastic/backend client calls.*

---

## 2. Orchestration Manager

Core logic lives in `orchestration.py`. It:

1. **Special commands:** e.g. "reset" → clear state and return.
2. **Rate limit:** via RedisManager.
3. **Conversation state:** load/save from Redis.
4. **Intent analysis:** `xai_client.analyze_intent(user_text, history, tools, role)`.
5. **Context resolution:** fill IDs from `last_message_context`.
6. **Missing params:** ask user or use context.
7. **Action execution:** call services (GigMart uses MCP; TA-DA will use direct HTTP to backend/Elastic).
8. **State updates:** save last message context for follow-ups.

### TA-DA adaptation

Instead of MCP tools, define a small set of **actions** and call your APIs directly:

- `search_transcripts` → `POST /search/semantic` on backend
- `ask_agent` → `POST /agent/converse` on backend
- `update_session_state` → Elasticsearch `ta-da-session-state`
- etc.

---

## 3. XAI Client (NLU)

`xai_client.py` uses **OpenAI SDK** with XAI base URL:

```python
from openai import AsyncOpenAI
self.client = AsyncOpenAI(
    api_key=api_key,
    base_url="https://api.x.ai/v1",
    timeout=30
)
```

### `analyze_intent()`

- **Input:** `user_text`, `conversation_history`, `available_tools`, `role`, `last_message_context`.
- **Output:** JSON with `intent`, `tools`, `parameters`, `missing_params`, `is_multi_step`.
- **Retries:** 3 attempts, exponential backoff.

System prompt comes from `prompts.get_system_prompt(role, tools, last_message_context)` and includes:

- Role context
- Tool descriptions + params
- Last message context (entities for follow-ups)
- JSON schema for response

---

## 4. Redis Manager

`redis_manager.py` handles:

- **Conversation state:** `save_conversation_state()`, `get_conversation_state()`, `clear_conversation()`.
- **Tool schema cache:** `cache_tool_schemas()`, `get_cached_tool_schemas()`.
- **Rate limiting:** `check_rate_limit(sender)` (e.g. 10 req/min).

If Redis is unavailable, it falls back to in-memory storage.

---

## 5. Config (Pydantic)

`config.py` defines:

- `AgentConfig` – seed phrases
- `XAIConfig` – LLM API key, model, base URL
- `RedisConfig` – Redis URL, TTLs
- `RuntimeConfig` – rate limit, history size, etc.

All values come from env (with `.env` via `python-dotenv`).

*TA-DA: Add `ElasticConfig` (ES URL, API key) and `BackendConfig` (backend URL) instead of MCP.*

---

## Adapting for TA-DA

### Suggested mapping

| GigMart | TA-DA |
|---------|-------|
| Entrepreneur Agent | Tutor Agent (or Moments Agent) |
| Freelancer Agent | ClassOps Agent (or Confusion Agent) |
| MCP tools | Direct API calls (backend, Elasticsearch) |
| XAI Grok | Elastic Agent Builder or OpenAI/Anthropic |
| Redis | Elasticsearch (ta-da-session-state) or Redis |

### Minimal TA-DA agent skeleton

1. **Agent:** `tutor_agent.py` or `classops_agent.py` using uAgents + chat protocol.
2. **Orchestration:** simplified `OrchestrationManager` that:
   - Uses Elastic Agent Builder or your LLM for intent.
   - Calls backend and Elasticsearch **directly** (HTTP/requests).
3. **State:** Elasticsearch `ta-da-session-state` (or Redis).
4. **Actions:** `search_transcripts` → `POST backend/search/semantic`, `ask_agent` → `POST backend/agent/converse`, `update_session` → Elastic index.

### Dependencies (TA-DA, no MCP)

```
uagents==0.22.10
uagents-core==0.3.11
openai>=1.0.0   # if using OpenAI-compatible LLM
redis>=5.0.0    # optional
pydantic>=2.5.0
python-dotenv==1.2.1
requests==2.32.5
elasticsearch>=8.0.0   # for direct Elastic access if needed
```

### References

- [GigMart repo](https://github.com/pb2323/GigMart)
- [uAgents framework](https://github.com/fetchai/uAgents)
- [FetchAI Agentverse](https://agentverse.ai)
