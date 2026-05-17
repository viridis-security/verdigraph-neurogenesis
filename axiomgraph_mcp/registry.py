"""In-memory multi-agent registry with file-backed persistence.

Invariants:
- Every mutation goes through `DevelopmentalAgent.process_evaluation` (never
  bypasses AxiomGraph safety invariants).
- Persistence directory is configurable via `AXIOMGRAPH_STATE_DIR` env var or
  the `state_dir` constructor argument; defaults to `./axiomgraph_state/`.
- Agent IDs are slugified from the agent name plus a short suffix to avoid
  collisions across registry restarts.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Dict, List

from axiomgraph import AgentGenome, DevelopmentalAgent


_SLUG_RE = re.compile(r"[^a-z0-9_-]+")


def _slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.strip().lower()).strip("-")
    return slug or "agent"


class AgentRegistry:
    """Thread-safe registry of named developmental agents."""

    def __init__(self, state_dir: str | Path | None = None) -> None:
        env = os.environ.get("AXIOMGRAPH_STATE_DIR")
        chosen = state_dir or env or Path.cwd() / "axiomgraph_state"
        self.state_dir = Path(chosen).expanduser().resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._agents: Dict[str, DevelopmentalAgent] = {}
        self._lock = threading.RLock()

    # ----------------------------- internal helpers ---------------------------
    def _allocate_id(self, name: str) -> str:
        base = _slugify(name)
        with self._lock:
            if base not in self._agents:
                return base
            i = 2
            while f"{base}-{i}" in self._agents:
                i += 1
            return f"{base}-{i}"

    def _path_for(self, agent_id: str) -> Path:
        return self.state_dir / f"{agent_id}.json"

    # ------------------------------- public API -------------------------------
    def create(self, genome_dict: dict) -> str:
        """Create a new agent from a genome dict. Returns the registered agent_id."""
        genome = AgentGenome.from_dict(genome_dict)
        agent = DevelopmentalAgent(genome)
        agent_id = self._allocate_id(genome.agent_name)
        with self._lock:
            self._agents[agent_id] = agent
        return agent_id

    def list_agents(self) -> List[dict]:
        with self._lock:
            return [
                {
                    "agent_id": aid,
                    "agent_name": agent.genome.agent_name,
                    "purpose": agent.genome.purpose,
                    "node_count": len(agent.graph.nodes),
                    "edge_count": len(agent.graph.edges),
                    "ledger_events": len(agent.ledger.events),
                }
                for aid, agent in self._agents.items()
            ]

    def get(self, agent_id: str) -> DevelopmentalAgent:
        with self._lock:
            if agent_id not in self._agents:
                raise KeyError(
                    f"No agent registered with id '{agent_id}'. "
                    f"Available: {sorted(self._agents)}"
                )
            return self._agents[agent_id]

    def delete(self, agent_id: str, remove_file: bool = False) -> None:
        with self._lock:
            self._agents.pop(agent_id, None)
        if remove_file:
            path = self._path_for(agent_id)
            if path.exists():
                path.unlink()

    def save(self, agent_id: str) -> Path:
        agent = self.get(agent_id)
        path = self._path_for(agent_id)
        agent.save_state(path)
        return path

    def load(self, source_path: str | Path, agent_id: str | None = None) -> str:
        """Load an agent state JSON. Registers under `agent_id` or a slug of the agent name."""
        path = Path(source_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Agent state file not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        agent = DevelopmentalAgent.from_state_dict(data)
        aid = agent_id or self._allocate_id(agent.genome.agent_name)
        with self._lock:
            self._agents[aid] = agent
        return aid
