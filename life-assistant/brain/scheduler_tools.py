from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from scheduler import CanvasItem, ItemType, SchedulingEngine, TimeSlot
from scheduler.models import SchedulingProposal

from .types import Tool


def _serialize_item(item: CanvasItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "type": item.type.value,
        "start": item.start.isoformat(),
        "end": item.end.isoformat(),
        "urgency": item.urgency,
        "inertia": item.inertia,
        "status": item.status.value,
        "type_data": item.type_data,
    }


def _serialize_slot(slot: Optional[TimeSlot]) -> Optional[dict[str, Any]]:
    if slot is None:
        return None
    return {"start": slot.start.isoformat(), "end": slot.end.isoformat()}


def _serialize_proposal(proposal: SchedulingProposal) -> dict[str, Any]:
    return {
        "decision": proposal.decision,
        "committed": "id" in proposal.requested,
        "item_id": proposal.requested.get("id"),
        "conflicts": [_serialize_item(c) for c in proposal.conflicts],
        "displacements": [
            {"item": _serialize_item(plan.item), "new_slot": _serialize_slot(plan.new_slot)}
            for plan in proposal.displacements
        ],
        "alternative_slot": _serialize_slot(proposal.alternative_slot),
    }


def build_scheduler_tools(engine: SchedulingEngine) -> list[Tool]:
    """Expose the step-1 SchedulingEngine as tools the brain can call. Every
    handler here just parses/serializes; all negotiation logic stays in the
    engine."""

    def get_schedule(date: str) -> dict[str, Any]:
        day = datetime.fromisoformat(date).date()
        items = engine.get_schedule(day)
        return {"date": date, "items": [_serialize_item(i) for i in items]}

    def check_conflict(start: str, end: str) -> dict[str, Any]:
        conflicts = engine.check_conflict(datetime.fromisoformat(start), datetime.fromisoformat(end))
        return {"conflicts": [_serialize_item(c) for c in conflicts]}

    def find_next_available(
        duration_minutes: int, urgency: int = 3, earliest: Optional[str] = None
    ) -> dict[str, Any]:
        earliest_dt = datetime.fromisoformat(earliest) if earliest else None
        slot = engine.find_next_available(timedelta(minutes=duration_minutes), urgency=urgency, earliest=earliest_dt)
        return {"slot": _serialize_slot(slot)}

    def add_task(
        title: str,
        type: str,
        start: str,
        end: str,
        urgency: int,
        inertia: int,
        confirm_displacement: bool = False,
    ) -> dict[str, Any]:
        proposal = engine.add_task(
            title,
            ItemType(type),
            datetime.fromisoformat(start),
            datetime.fromisoformat(end),
            urgency,
            inertia,
            auto_apply_displacement=confirm_displacement,
        )
        return _serialize_proposal(proposal)

    def move_task(
        item_id: str, new_start: str, new_end: str, confirm_displacement: bool = False
    ) -> dict[str, Any]:
        proposal = engine.move_task(
            item_id,
            datetime.fromisoformat(new_start),
            datetime.fromisoformat(new_end),
            auto_apply_displacement=confirm_displacement,
        )
        return _serialize_proposal(proposal)

    return [
        Tool(
            name="get_schedule",
            description="Get everything scheduled on a given calendar date.",
            parameters={
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format."},
                },
                "required": ["date"],
            },
            handler=get_schedule,
        ),
        Tool(
            name="check_conflict",
            description="List items on the canvas that overlap a given time range.",
            parameters={
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "ISO 8601 datetime, e.g. 2026-08-05T14:00:00"},
                    "end": {"type": "string", "description": "ISO 8601 datetime"},
                },
                "required": ["start", "end"],
            },
            handler=check_conflict,
        ),
        Tool(
            name="find_next_available",
            description=(
                "Find the next time slot of the given duration where nothing on the canvas "
                "needs to move. Use this to suggest an alternative when a requested slot is busy."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "duration_minutes": {"type": "integer", "minimum": 1},
                    "urgency": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "description": "Urgency of the item you're trying to schedule. Defaults to 3.",
                    },
                    "earliest": {
                        "type": "string",
                        "description": "ISO 8601 datetime to start searching from. Defaults to now.",
                    },
                },
                "required": ["duration_minutes"],
            },
            handler=find_next_available,
        ),
        Tool(
            name="add_task",
            description=(
                "Add a new item to the schedule. If the slot is free it is booked immediately "
                "(decision='direct'). If it collides with something that should NOT be bumped, "
                "nothing is booked and the result includes an alternative_slot to offer instead "
                "(decision='alternative'). If it collides only with items that are clearly less "
                "important, nothing is booked yet either (decision='displace') -- explain the "
                "tradeoff to the user and only call this again with confirm_displacement=true "
                "once they agree to bump those items."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": ["sleep", "meal", "work", "social", "supplement", "task", "meeting"],
                    },
                    "start": {"type": "string", "description": "ISO 8601 datetime"},
                    "end": {"type": "string", "description": "ISO 8601 datetime"},
                    "urgency": {"type": "integer", "minimum": 1, "maximum": 5},
                    "inertia": {"type": "integer", "minimum": 1, "maximum": 5},
                    "confirm_displacement": {
                        "type": "boolean",
                        "description": (
                            "Set true only after the user has explicitly agreed to bump the "
                            "conflicting items listed in a previous 'displace' proposal."
                        ),
                    },
                },
                "required": ["title", "type", "start", "end", "urgency", "inertia"],
            },
            handler=add_task,
        ),
        Tool(
            name="move_task",
            description=(
                "Move an existing scheduled item to a new time, subject to the same negotiation "
                "rules as add_task (may return decision='alternative' or 'displace')."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "item_id": {"type": "string"},
                    "new_start": {"type": "string", "description": "ISO 8601 datetime"},
                    "new_end": {"type": "string", "description": "ISO 8601 datetime"},
                    "confirm_displacement": {"type": "boolean"},
                },
                "required": ["item_id", "new_start", "new_end"],
            },
            handler=move_task,
        ),
    ]
