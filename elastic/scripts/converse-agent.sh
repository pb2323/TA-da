#!/usr/bin/env bash
# Call Elastic Agent Builder converse API and print response in a parsed way.
# Usage: ./converse-agent.sh "What is Operating Systems?"
# Env: KIBANA_URL (e.g. https://xxx.kb.us-west1.gcp.elastic.cloud), ELASTIC_API_KEY

set -e
INPUT="${1:-What is Operating Systems?}"
KIBANA_URL="${KIBANA_URL:-https://my-elasticsearch-project-f5fc5f.kb.us-west1.gcp.elastic.cloud}"
AGENT_ID="${AGENT_ID:-tada-agent}"

if [[ -z "$ELASTIC_API_KEY" ]]; then
  echo "Set ELASTIC_API_KEY (e.g. source ../.env.local or export ELASTIC_API_KEY=...)"
  exit 1
fi

RESPONSE=$(curl -s -X POST "${KIBANA_URL}/api/agent_builder/converse" \
  -H "Authorization: ApiKey ${ELASTIC_API_KEY}" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d "{\"input\": \"${INPUT}\", \"agent_id\": \"${AGENT_ID}\"}")

# Pretty-print JSON if possible; otherwise show raw
if command -v jq &>/dev/null; then
  echo "$RESPONSE" | jq .
elif command -v python3 &>/dev/null; then
  echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2, default=str))" 2>/dev/null || echo "$RESPONSE"
else
  echo "$RESPONSE"
fi
