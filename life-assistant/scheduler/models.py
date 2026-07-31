from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


class ItemType(str, enum.Enum):
    SLEEP = "sleep"
    MEAL = "meal"
    WORK = "work"
    SOCIAL = "social"
    SUPPLEMENT = "supplement"
    TASK = "task"
    MEETING = "meeting"


class ItemStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


MIN_SCORE = 1
MAX_SCORE = 5


def validate_score(name: str, value: int) -> None:
    if not (MIN_SCORE <= value <= MAX_SCORE):
        raise ValueError(f"{name} must be between {MIN_SCORE} and {MAX_SCORE}, got {value}")


@dataclass
class CanvasItem:
    """A single scheduled thing on the canvas: a task, a meal, a block of sleep, etc."""

    id: str
    title: str
    type: ItemType
    start: datetime
    end: datetime
    urgency: int
    inertia: int
    status: ItemStatus = ItemStatus.SCHEDULED
    type_data: dict[str, Any] = field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def __post_init__(self) -> None:
        self.type = ItemType(self.type)
        self.status = ItemStatus(self.status)
        if self.end <= self.start:
            raise ValueError("end must be after start")
        validate_score("urgency", self.urgency)
        validate_score("inertia", self.inertia)

    @property
    def duration(self):
        return self.end - self.start


@dataclass
class TimeSlot:
    start: datetime
    end: datetime

    @property
    def duration(self):
        return self.end - self.start


@dataclass
class DisplacementPlan:
    """A proposal to move an existing item out of the way to make room for a new one."""

    item: CanvasItem
    new_slot: TimeSlot


@dataclass
class SchedulingProposal:
    """The result of asking the engine to place an item.

    decision is one of:
      - "direct": the slot is free, nothing else is affected.
      - "displace": the slot is occupied, but every occupying item's inertia is
        clearly outweighed by the new item's urgency, so `displacements` describes
        where each of them would move to make room.
      - "alternative": the slot is occupied by at least one item that should NOT be
        bumped, so `alternative_slot` (if any) is the next fully-free slot instead.
    Nothing is written to storage until the proposal is applied.
    """

    decision: str
    requested: dict[str, Any]
    conflicts: list[CanvasItem] = field(default_factory=list)
    displacements: list[DisplacementPlan] = field(default_factory=list)
    alternative_slot: Optional[TimeSlot] = None
