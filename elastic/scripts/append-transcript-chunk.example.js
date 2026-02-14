/**
 * Example: append transcript chunks to the ta-da-latest index.
 * Contract and field definitions: see elastic/INDEXING.md
 *
 * Install: npm install @elastic/elasticsearch
 * Env: ELASTIC_CLOUD_ID, ELASTIC_API_KEY
 */

const { Client } = require('@elastic/elasticsearch');

const client = new Client({
  cloud: { id: process.env.ELASTIC_CLOUD_ID },
  auth: { apiKey: process.env.ELASTIC_API_KEY },
});

const INDEX = 'ta-da-latest';

/**
 * Index a single transcript chunk (append). Each call adds a new document.
 * @param {Object} chunk - { meeting_id, chunk_index, text, start_time?, end_time?, speaker_id? }
 */
async function appendTranscriptChunk(chunk) {
  const doc = {
    meeting_id: chunk.meeting_id,
    chunk_index: chunk.chunk_index,
    text: chunk.text,
    start_time: chunk.start_time ?? null,
    end_time: chunk.end_time ?? null,
    speaker_id: chunk.speaker_id ?? null,
    meeting_start_time: chunk.meeting_start_time ?? null,
    received_at: new Date().toISOString(),
    source: chunk.source ?? 'zoom_agent',
  };

  const result = await client.index({
    index: INDEX,
    document: doc,
    // Let Elasticsearch auto-generate _id so every chunk is a new document (append).
  });

  return result;
}

/**
 * Append multiple chunks in one bulk request (efficient for batches).
 */
async function appendTranscriptChunks(chunks) {
  const operations = chunks.flatMap((chunk) => [
    { index: { index: INDEX } },
    {
      meeting_id: chunk.meeting_id,
      chunk_index: chunk.chunk_index,
      text: chunk.text,
      start_time: chunk.start_time ?? null,
      end_time: chunk.end_time ?? null,
      speaker_id: chunk.speaker_id ?? null,
      meeting_start_time: chunk.meeting_start_time ?? null,
      received_at: new Date().toISOString(),
      source: chunk.source ?? 'zoom_agent',
    },
  ]);

  const result = await client.bulk({ operations, refresh: false });
  if (result.errors) {
    const failed = result.items.filter((i) => i.index?.error);
    throw new Error(`Bulk index errors: ${JSON.stringify(failed)}`);
  }
  return result;
}

// Example usage (single chunk)
async function main() {
  await appendTranscriptChunk({
    meeting_id: 'zoom-meeting-123',
    chunk_index: 0,
    text: 'Welcome to the DBMS crash course. Today we will cover ACID properties.',
    start_time: 0.0,
    end_time: 5.2,
    speaker_id: 'instructor',
  });
  console.log('Appended one chunk.');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { appendTranscriptChunk, appendTranscriptChunks };
