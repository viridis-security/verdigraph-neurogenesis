from __future__ import annotations

import json
from pathlib import Path

from .genome import AgentGenome


def load_genome(path: str | Path) -> AgentGenome:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return AgentGenome.from_dict(data)
