#!/usr/bin/env bash
# setup_cowork_mcps.sh
# Bootstraps the MCP servers the Viridis Operator hourly-triage agent needs.
#
# Architecture:
#   - verdigraph-mcp  : LOCAL stdio MCP (installed into project venv here)
#   - github-mcp      : REMOTE hosted MCP (api.githubcopilot.com, OAuth)
#
# Run once on Justin's Mac:
#   bash ~/Desktop/Cowork\ /axiomgraph_neurogenesis/scripts/setup_cowork_mcps.sh

set -euo pipefail

PROJECT_DIR="${HOME}/Desktop/Cowork /axiomgraph_neurogenesis"
VENV_DIR="${PROJECT_DIR}/.venv"
STATE_DIR="${PROJECT_DIR}/verdigraph_state"
CLAUDE_CFG_DIR="${HOME}/Library/Application Support/Claude"
EMIT_CFG="${PROJECT_DIR}/scripts/cowork_mcp_config.fragment.json"

mkdir -p "${STATE_DIR}"

echo "==> [1/2] Installing verdigraph-mcp into ${VENV_DIR}"
if [ ! -d "${VENV_DIR}" ]; then
  python3 -m venv "${VENV_DIR}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -e "${PROJECT_DIR}[mcp]"
deactivate

if [ ! -x "${VENV_DIR}/bin/verdigraph-mcp" ]; then
  echo "ERROR: verdigraph-mcp entrypoint missing at ${VENV_DIR}/bin/verdigraph-mcp" >&2
  exit 1
fi
echo "    verdigraph-mcp -> ${VENV_DIR}/bin/verdigraph-mcp"

echo "==> [2/2] Writing Cowork MCP config fragment to ${EMIT_CFG}"
cat > "${EMIT_CFG}" <<JSON
{
  "_comment": "Two-server setup: verdigraph-mcp runs locally over stdio; github-mcp is GitHub's hosted remote MCP at api.githubcopilot.com (OAuth handled by Cowork).",
  "mcpServers": {
    "verdigraph-mcp": {
      "command": "${VENV_DIR}/bin/verdigraph-mcp",
      "args": [],
      "env": {
        "VERDIGRAPH_STATE_DIR": "${STATE_DIR}"
      }
    },
    "github-mcp": {
      "url": "https://api.githubcopilot.com/mcp/",
      "transport": "http",
      "auth": "oauth"
    }
  }
}
JSON

cat <<MSG

================================================================================
DONE. Next steps:

1. Open Cowork settings, merge the two server entries from:
     ${EMIT_CFG}
   into:
     ${CLAUDE_CFG_DIR}/claude_desktop_config.json
   (or use Cowork's "Add MCP server" UI — paste the URL for github-mcp.)

2. Relaunch Cowork. On first connect, GitHub MCP will open an OAuth flow in
   your browser; approve with the viridis-security account and grant the
   issues/PRs/repos scopes.

3. Both servers should appear connected. The next :15 hourly run will execute.

   Alt: if you'd prefer a fine-grained PAT instead of OAuth, swap the
   github-mcp entry for:
     {
       "url": "https://api.githubcopilot.com/mcp/",
       "transport": "http",
       "headers": { "Authorization": "Bearer <PAT>" }
     }
================================================================================
MSG
