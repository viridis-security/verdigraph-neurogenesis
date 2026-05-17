from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, List

from .graph import utc_now


@dataclass
class LedgerEvent:
    event_type: str
    reason: str
    payload: Dict[str, object] = field(default_factory=dict)
    timestamp: str = field(default_factory=utc_now)


class DevelopmentalLedger:
    """Append-only record of graph development."""

    def __init__(self) -> None:
        self.events: List[LedgerEvent] = []

    def record(self, event_type: str, reason: str, **payload: object) -> LedgerEvent:
        event = LedgerEvent(event_type=event_type, reason=reason, payload=payload)
        self.events.append(event)
        return event

    def to_list(self) -> List[Dict[str, object]]:
        return [asdict(event) for event in self.events]
