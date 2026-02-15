/**
 * TA-DA Backend (Render)
 * - POST /events: Zoom App UI sends events here; we route to Tutor or ClassOps agent (or update Elastic for CONCEPT_SET).
 */

import { config } from "dotenv";
config();

import express from "express";
import { Client } from "@elastic/elasticsearch";

const app = express();
app.use(express.json());

const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || "https://localhost:9200";
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY || "";
const KIBANA_URL =
  process.env.KIBANA_URL ||
  ELASTICSEARCH_URL.replace(".es.", ".kb.").replace(/:443$/, "");
const TUTOR_AGENT_URL = process.env.TUTOR_AGENT_URL || "http://localhost:5001";
const CLASSOPS_AGENT_URL = process.env.CLASSOPS_AGENT_URL || "http://localhost:5002";

const INDEX_SESSIONS = "ta-da-sessions";
const INDEX_TA_DA_LATEST = "ta-da-latest";
const INDEX_CONCEPT_CARDS = "ta-da-concept-cards";

function getElastic() {
  if (!ELASTIC_API_KEY) throw new Error("ELASTIC_API_KEY required for CONCEPT_SET");
  return new Client({ node: ELASTICSEARCH_URL, auth: { apiKey: ELASTIC_API_KEY } });
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ta-da-backend" });
});

/**
 * Semantic search over ta-da-latest transcript chunks.
 * For Zoom app or backend: find chunks by natural-language query (semantic search on content field).
 *
 * POST /search/semantic
 * Body: { "query": string (required), "meeting_id"?: string, "size"?: number (default 10) }
 * Returns: { "hits": [ { "_id", "_score", "meeting_id", "chunk_index", "text", "start_time", "end_time", ... } ] }
 */
app.post("/search/semantic", async (req, res) => {
  const { query, meeting_id, size = 10 } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "body must include query (string)" });
  }

  try {
    const es = getElastic();
    const retriever = {
      standard: {
        query: { semantic: { field: "content", query: query.trim() } },
        ...(meeting_id && { filter: { term: { meeting_id } } }),
      },
    };
    const response = await es.search({
      index: INDEX_TA_DA_LATEST,
      size: Math.min(Math.max(1, Number(size) || 10), 100),
      retriever,
    });

    const hits = (response.hits?.hits || []).map((h) => ({
      _id: h._id,
      _score: h._score,
      ...h._source,
    }));

    return res.json({ hits });
  } catch (e) {
    console.error("search/semantic error", e);
    return res.status(500).json({ error: e.message || "search failed" });
  }
});

/**
 * Fetch all concept cards from ta-da-concept-cards index.
 *
 * GET /concept-cards
 * Query: meeting_id (optional) - filter by meeting_id
 *        size (optional) - max hits (default 100, max 1000)
 * Returns: { hits: [ { _id, _score, meeting_id, concept_id, title, short_explain, example, timestamp }, ... ] }
 */
app.get("/concept-cards", async (req, res) => {
  try {
    const es = getElastic();
    const meeting_id = req.query.meeting_id;
    const size = Math.min(Math.max(1, parseInt(req.query.size, 10) || 100), 1000);

    const query = meeting_id
      ? { bool: { filter: [{ term: { meeting_id } }] } }
      : { match_all: {} };

    const response = await es.search({
      index: INDEX_CONCEPT_CARDS,
      query,
      size,
      sort: [{ timestamp: { unmapped_type: "date", order: "asc" } }],
    });

    const hits = (response.hits?.hits || []).map((h) => ({
      _id: h._id,
      _score: h._score,
      ...h._source,
    }));

    return res.json({
      total: response.hits?.total?.value ?? hits.length,
      hits,
    });
  } catch (e) {
    console.error("concept-cards error", e);
    return res.status(500).json({ error: e.message || "concept-cards fetch failed" });
  }
});

/**
 * Elastic Agent Builder converse: ask the TA-DA agent a question.
 * Proxies to Kibana Agent Builder API and returns the full response.
 *
 * POST /agent/converse
 * Body: { "input": string (required), "agent_id"?: string (default: tada-agent) }
 * Returns: converse API response (conversation_id, steps, response.message, etc.)
 */
app.post("/agent/converse", async (req, res) => {
  const { input, agent_id = "tada-agent" } = req.body || {};
  if (!input || typeof input !== "string") {
    return res.status(400).json({ error: "body must include input (string)" });
  }

  try {
    if (!ELASTIC_API_KEY) {
      return res.status(500).json({ error: "ELASTIC_API_KEY required for agent converse" });
    }
    const r = await fetch(`${KIBANA_URL}/api/agent_builder/converse`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${ELASTIC_API_KEY}`,
        "kbn-xsrf": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: input.trim(), agent_id }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    return res.json(data);
  } catch (e) {
    console.error("agent/converse error", e);
    return res.status(500).json({ error: e.message || "converse failed" });
  }
});

/**
 * Event types from UI:
 * - SIGNAL_SUBMIT   -> ClassOps Agent
 * - QUESTION_SUBMIT -> Tutor Agent
 * - TUTOR_REPLY     -> Tutor Agent
 * - CONCEPT_SET     -> update sessions.active_concept (Elastic)
 */
app.post("/events", async (req, res) => {
  const body = req.body || {};
  const type = body.type || body.event_type;

  if (!type) {
    return res.status(400).json({ error: "missing type or event_type" });
  }

  try {
    switch (type) {
      case "SIGNAL_SUBMIT": {
        const r = await fetch(`${CLASSOPS_AGENT_URL}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: body.session_id,
            user_id: body.user_id,
            concept_id: body.concept_id,
            signal: body.signal,
          }),
        });
        const data = await r.json().catch(() => ({}));
        return res.status(r.ok ? 200 : 502).json(data);
      }

      case "QUESTION_SUBMIT": {
        const r = await fetch(`${TUTOR_AGENT_URL}/question`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: body.session_id,
            user_id: body.user_id,
            concept_id: body.concept_id,
            question_text: body.question_text ?? body.question,
          }),
        });
        const data = await r.json().catch(() => ({}));
        return res.status(r.ok ? 200 : 502).json(data);
      }

      case "TUTOR_REPLY": {
        const r = await fetch(`${TUTOR_AGENT_URL}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: body.session_id,
            user_id: body.user_id,
            concept_id: body.concept_id,
            user_text: body.user_text ?? body.user_msg,
          }),
        });
        const data = await r.json().catch(() => ({}));
        return res.status(r.ok ? 200 : 502).json(data);
      }

      case "CONCEPT_SET": {
        const session_id = body.session_id;
        const concept_id = body.concept_id;
        if (!session_id || concept_id === undefined) {
          return res.status(400).json({ error: "CONCEPT_SET requires session_id and concept_id" });
        }
        const es = getElastic();
        await es.update({
          index: INDEX_SESSIONS,
          id: session_id,
          doc: { session_id, active_concept: concept_id },
          doc_as_upsert: true,
        });
        return res.json({ ok: true, session_id, active_concept: concept_id });
      }

      default:
        return res.status(400).json({ error: `unknown event type: ${type}` });
    }
  } catch (e) {
    console.error("events error", type, e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TA-DA backend listening on port ${PORT}`);
});
