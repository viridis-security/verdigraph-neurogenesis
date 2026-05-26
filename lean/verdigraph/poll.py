#!/usr/bin/env python3
"""Poll the three Aristotle T-VG-* runs and report status.

Usage:
    ARISTOTLE_KEY=$(head -1 'env/VERDIGRAPH API key .md' | sed 's/^API key //; s/\\//g') \
        python3 lean/verdigraph/poll.py
"""
import os, asyncio, json
from pathlib import Path
import aristotlelib as A

HERE = Path(__file__).parent
TRACKING = HERE / "SUBMISSIONS.json"

STATUS_LABELS = {
    0: "pending",
    1: "running",
    2: "complete",
    3: "failed",
    4: "cancelled",
}

async def main():
    A.set_api_key(os.environ["ARISTOTLE_KEY"])
    tracking = json.loads(TRACKING.read_text())
    print(f"Polling {len(tracking['submissions'])} submissions...")
    print()
    for s in tracking["submissions"]:
        if not s.get("ok"):
            print(f"  {s['label']}: SUBMIT FAILED — {s.get('error')}")
            continue
        try:
            proj = await A.Project.from_id(s["project_id"])
            label = STATUS_LABELS.get(proj.status, f"unknown({proj.status})")
            print(f"  {s['label']}: status={label} files={proj.has_files} last_updated={proj.last_updated}")
        except Exception as e:
            print(f"  {s['label']}: POLL ERROR — {type(e).__name__}: {e}")

asyncio.run(main())
