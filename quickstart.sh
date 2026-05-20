#!/usr/bin/env bash
# quickstart.sh — go from `git clone` to first deterministic brain in 60 seconds.
#
# What this does:
#   1. Creates a Python 3.10+ virtualenv at .venv/
#   2. pip install -e ".[dev]"
#   3. Runs the brain CLI against an example genome, prints the deterministic id
#   4. Optionally verifies against verdigraph.dev to prove byte-equivalence
#
# No Cloudflare account needed. No Stripe key needed. No verdigraph.dev account needed.

set -euo pipefail
cd "$(dirname "$0")"

PY=${PY:-python3}
VENV=".venv"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

green "▶ 1/4  Creating Python venv at $VENV"
if [[ ! -d "$VENV" ]]; then
  "$PY" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip

green "▶ 2/4  Installing verdigraph (editable)"
pip install --quiet -e ".[dev]"

green "▶ 3/4  Building a deterministic brain from examples/hypothetical_research_agent.genome.json"
GENOME_FILE="examples/hypothetical_research_agent.genome.json"
if [[ ! -f "$GENOME_FILE" ]]; then
  dim "  (example genome not found, generating an inline minimal one)"
  cat > /tmp/_qs_genome.json <<'JSON'
{
  "agent_name": "quickstart_demo",
  "purpose":    "Local deterministic build demo.",
  "initial_nodes":   ["planner", "executor"],
  "fitness_metrics": ["task_success_rate"]
}
JSON
  GENOME_FILE=/tmp/_qs_genome.json
fi

python -m verdigraph build --file "$GENOME_FILE" --format verdigraph_genome --summary --pretty

green "▶ 4/4  (optional) Confirming byte-equivalence with verdigraph.dev hosted Worker"
if command -v curl >/dev/null 2>&1; then
  LOCAL_ID=$(python -m verdigraph build --file "$GENOME_FILE" --format verdigraph_genome --summary | python3 -c "import json,sys; print(json.load(sys.stdin)['brain_id'])")
  REMOTE_ID=$(curl -sS --max-time 5 -X POST https://verdigraph.dev/app/import \
    -H 'content-type: application/json' \
    -d "$(python3 -c "import json; print(json.dumps({'format':'verdigraph_genome','content':open('$GENOME_FILE').read()}))")" \
    2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['preview']['brain_id'] if 'preview' in d else '')" 2>/dev/null || echo "")
  if [[ -n "$REMOTE_ID" && "$LOCAL_ID" == "$REMOTE_ID" ]]; then
    green "  ✓ local brain_id matches hosted Worker: $LOCAL_ID"
  else
    dim "  (skipped — hosted Worker unreachable or returned different id; local build is still authoritative)"
    dim "  local:  $LOCAL_ID"
    dim "  remote: ${REMOTE_ID:-(unreachable)}"
  fi
fi

echo
green "✓ All set."
echo
echo "Next steps:"
echo "  • Build any agent file:    python -m verdigraph build --file <your_agent.json> --pretty"
echo "  • Verify a saved brain:    python -m verdigraph verify brain.json"
echo "  • Run the MCP stdio server: source .venv/bin/activate && pip install -e \".[mcp]\" && verdigraph-mcp"
echo "  • Or hook it into Claude Desktop with: { \"command\": \"$(pwd)/.venv/bin/verdigraph-mcp\", \"args\": [] }"
echo
echo "Docs: README.md  ·  docs/CANONICALIZATION.md  ·  papers/"
