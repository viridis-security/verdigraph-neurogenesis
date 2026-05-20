#!/usr/bin/env bash
# scripts/deploy_live.sh — one-shot deploy from a clean Mac.
#
# Does:
#   1. Rotates Ed25519 attestation keys (fresh, never leaves your machine until secret put).
#   2. Applies D1 migrations 0002 / 0003 / 0004 to the remote (live) DB.
#   3. Sets VERDIGRAPH_ATTEST_PRIVKEY + VERDIGRAPH_ATTEST_PUBKEY as Worker secrets.
#   4. wrangler deploy.
#   5. Smoke test against verdigraph-mcp.hartjustin6.workers.dev.
#
# Run from inside the hosted-mcp directory:
#   bash scripts/deploy_live.sh
#
# Idempotent on re-run except for the secret-put step, which is safe to overwrite.

set -euo pipefail

# Local wrangler binary (no global install required).
WRANGLER="./node_modules/.bin/wrangler"
if [[ ! -x "$WRANGLER" ]]; then
  echo "ERROR: $WRANGLER not found. Run 'npm install' first." >&2
  exit 1
fi

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

step() { echo; green "==> $1"; }

step "1/5  Rotating Ed25519 attestation keys"
KEYS_OUT="$(node -e "
(async () => {
  const c = require('crypto').webcrypto;
  const kp = await c.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pk = new Uint8Array(await c.subtle.exportKey('pkcs8', kp.privateKey));
  const sp = new Uint8Array(await c.subtle.exportKey('spki',  kp.publicKey));
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  console.log(hex(pk.slice(-32)));
  console.log(hex(sp.slice(-32)));
})();
")"
PRIV="$(echo "$KEYS_OUT" | sed -n '1p')"
PUB="$(echo  "$KEYS_OUT" | sed -n '2p')"
if [[ ${#PRIV} -ne 64 || ${#PUB} -ne 64 ]]; then
  red "Key generation failed (PRIV=${#PRIV} PUB=${#PUB} hex chars; expected 64 each)"
  exit 1
fi
dim "Fresh keys generated (privkey held locally; pubkey will be exposed via /.well-known/...)."
dim "PUB=$PUB"

step "2/5  Applying D1 migrations to remote (verdigraph-ledger)"
for m in 0002_brain_builder.sql 0003_marketplace.sql 0004_attestations.sql; do
  echo "  -> $m"
  if ! "$WRANGLER" d1 execute verdigraph-ledger --remote --file "db/migrations/$m"; then
    red "    migration $m failed — if the tables already exist from a prior run, you can skip; otherwise inspect output above."
  fi
done

step "3/5  Storing attestation secrets on the Worker"
echo "$PRIV" | "$WRANGLER" secret put VERDIGRAPH_ATTEST_PRIVKEY
echo "$PUB"  | "$WRANGLER" secret put VERDIGRAPH_ATTEST_PUBKEY

step "4/5  wrangler deploy"
"$WRANGLER" deploy

step "5/5  Smoke test against workers.dev URL"
bash scripts/smoke_verdigraph_dev.sh "https://verdigraph-mcp.hartjustin6.workers.dev" || true

echo
green "Deploy complete. Once verdigraph.dev nameservers propagate and the Cloudflare zone is Active,"
green "attach the custom domain to the Worker and the same smoke test will pass on https://verdigraph.dev."
