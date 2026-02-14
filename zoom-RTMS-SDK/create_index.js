import dotenv from 'dotenv';
import { Client as ESClient } from '@elastic/elasticsearch';

dotenv.config();

const ES_INDEX = process.env.ES_INDEX || 'ta-da-latest';
const ELASTIC_URL = process.env.ELASTIC_URL || process.env.ELASTICSEARCH_URL;

if (!ELASTIC_URL) {
  console.error('❌ Set ELASTIC_URL to your Elasticsearch node');
  console.error('Example: ELASTIC_URL=http://localhost:9200');
  process.exit(1);
}

const esOpts = { node: ELASTIC_URL };
if (process.env.ELASTIC_API_KEY) {
  esOpts.auth = { apiKey: process.env.ELASTIC_API_KEY };
}

const es = new ESClient(esOpts);

async function createIndex() {
  try {
    // Test connection
    await es.ping();
    console.log('✅ Connected to Elasticsearch');

    // Check if index exists
    const exists = await es.indices.exists({ index: ES_INDEX });
    if (exists) {
      console.log(`ℹ️  Index ${ES_INDEX} already exists`);
      return;
    }

    // Create index with ta-da-latest schema
    await es.indices.create({
      index: ES_INDEX,
      body: {
        mappings: {
          properties: {
            meeting_id: { type: 'keyword' },
            chunk_index: { type: 'integer' },
            text: { type: 'text' },
            start_time: { type: 'float' },
            end_time: { type: 'float' },
            speaker_id: { type: 'keyword' },
            meeting_start_time: { type: 'date' },
            received_at: { type: 'date' },
            source: { type: 'keyword' },
            embedding: { type: 'dense_vector', dims: 1536 }
          }
        }
      }
    });

    console.log(`✅ Created index ${ES_INDEX}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await es.close();
  }
}

createIndex();
