#!/usr/bin/env bash
# Regenerate the Zenodo deposit folder from canonical sources.
# Usage:
#   ./scripts/stage_zenodo_deposit.sh <version>     (e.g. 0.2.0)
#
# Outputs:
#   zenodo_deposit/verdigraph-neurogenesis-v<version>/         unpacked
#   zenodo_deposit/verdigraph-neurogenesis-v<version>.zip      upload-ready
#   zenodo_deposit/verdigraph-neurogenesis-v<version>.tar.gz   alternative

set -euo pipefail

VERSION="${1:?missing version arg, e.g. 0.2.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/zenodo_deposit/verdigraph-neurogenesis-v${VERSION}"

rm -rf "$DEP"
mkdir -p "$DEP/papers" "$DEP/docs" "$DEP/lean/verdigraph"

# Canonical artifacts
cp "$ROOT"/papers/PAPER_*.md "$DEP/papers/"
cp "$ROOT"/papers/PAPER_*.pdf "$DEP/papers/" 2>/dev/null || true
cp "$ROOT/LICENSE" "$DEP/"
cp "$ROOT/docs/lean_formalization_scope.md" "$DEP/docs/" 2>/dev/null || true

# Lean projects (post-T-VG)
for proj in T-VG-01-ledger-append-only T-VG-02-conservation-share T-VG-03-pruning-protected; do
  if [ -d "$ROOT/lean/verdigraph/$proj" ]; then
    mkdir -p "$DEP/lean/verdigraph/$proj"
    cp -r "$ROOT/lean/verdigraph/$proj/"* "$DEP/lean/verdigraph/$proj/"
  fi
done
[ -f "$ROOT/lean/verdigraph/SUBMISSIONS.json" ] && cp "$ROOT/lean/verdigraph/SUBMISSIONS.json" "$DEP/lean/verdigraph/"
[ -f "$ROOT/lean/verdigraph/poll.py" ]          && cp "$ROOT/lean/verdigraph/poll.py" "$DEP/lean/verdigraph/"

# Carry deposit-only metadata if present from a hand-curated source (else fail loudly)
if [ -f "$ROOT/docs/zenodo/v${VERSION}.zenodo.json" ]; then
  cp "$ROOT/docs/zenodo/v${VERSION}.zenodo.json" "$DEP/.zenodo.json"
else
  echo "WARNING: no .template.zenodo.json — copy .zenodo.json from prior version and update by hand"
fi

# Privacy check
if [ -d "$DEP/env" ] || grep -RIl "arstl_" "$DEP/" 2>/dev/null; then
  echo "FAIL: secret-bearing material in deposit; aborting"
  exit 2
fi

# Archives
( cd "$ROOT/zenodo_deposit" && \
  rm -f "verdigraph-neurogenesis-v${VERSION}.zip" "verdigraph-neurogenesis-v${VERSION}.tar.gz" && \
  zip -rq "verdigraph-neurogenesis-v${VERSION}.zip" "verdigraph-neurogenesis-v${VERSION}" && \
  tar -czf "verdigraph-neurogenesis-v${VERSION}.tar.gz" "verdigraph-neurogenesis-v${VERSION}" )

echo "Staged: $DEP"
echo "Archives:"
ls -la "$ROOT/zenodo_deposit/verdigraph-neurogenesis-v${VERSION}".{zip,tar.gz}
