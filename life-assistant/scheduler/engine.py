from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, time, timedelta
from typing import Any, Optional

from .models import (
    CanvasItem,
    DisplacementPlan,
    ItemType,
    SchedulingProposal,
    TimeSlot,
    validate_score,
)
from .storage import Canvas, new_id

DEFAULT_DAY_START = time(7, 0)
DEFAULT_DAY_END = time(23, 0)
DEFAULT_SEARCH_HORIZON_DAYS = 30

# How much a new item's urgency must exceed an existing item's inertia before
# the engine will propose bumping it. A plain ">" would let a request edge out
# an equally-stubborn item on a technicality; the spec calls for the new
# request to *clearly* outweigh the cost of moving the old one.
DEFAULT_DISPLACEMENT_MARGIN = 2


def is_displaceable(new_urgency: int, existing_inertia: int, margin: int = DEFAULT_DISPLACEMENT_MARGIN) -> bool:
    return (new_urgency - existing_inertia) >= margin


def _overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def _find_free_slot(
    busy: list[tuple[datetime, datetime]],
    duration: timedelta,
    earliest: datetime,
    day_start: time,
    day_end: time,
    horizon_days: int,
) -> Optional[TimeSlot]:
    """Earliest slot of `duration`, at/after `earliest`, inside the [day_start, day_end)
    window on each day, that overlaps none of `busy`. Deterministic greedy scan: on a
    collision, jump straight to the end of whatever it collided with."""
    busy = sorted(busy, key=lambda b: b[0])
    base_day = earliest.date()
    for offset in range(horizon_days):
        day = base_day + timedelta(days=offset)
        window_start = datetime.combine(day, day_start)
        window_end = datetime.combine(day, day_end)
        cursor = max(window_start, earliest) if offset == 0 else window_start
        while cursor + duration <= window_end:
            candidate_end = cursor + duration
            blocking = next((b for b in busy if _overlaps(cursor, candidate_end, b[0], b[1])), None)
            if blocking is None:
                return TimeSlot(cursor, candidate_end)
            cursor = blocking[1]
    return None


class SchedulingEngine:
    """Deterministic scheduling logic: no LLM involved. An LLM layer can call
    these methods as tools, but every decision here is plain, testable Python."""

    def __init__(
        self,
        canvas: Canvas,
        *,
        day_start: time = DEFAULT_DAY_START,
        day_end: time = DEFAULT_DAY_END,
        search_horizon_days: int = DEFAULT_SEARCH_HORIZON_DAYS,
        displacement_margin: int = DEFAULT_DISPLACEMENT_MARGIN,
    ):
        self.canvas = canvas
        self.day_start = day_start
        self.day_end = day_end
        self.search_horizon_days = search_horizon_days
        self.displacement_margin = displacement_margin

    # ---- primitives ----------------------------------------------------

    def get_schedule(self, day: date) -> list[CanvasItem]:
        start = datetime.combine(day, time.min)
        end = start + timedelta(days=1)
        return self.canvas.list_between(start, end)

    def check_conflict(
        self, start: datetime, end: datetime, exclude_id: Optional[str] = None
    ) -> list[CanvasItem]:
        return self.canvas.list_between(start, end, exclude_id=exclude_id)

    def find_next_available(
        self,
        duration: timedelta,
        urgency: int = 3,
        earliest: Optional[datetime] = None,
        exclude_id: Optional[str] = None,
    ) -> Optional[TimeSlot]:
        """Next slot where nothing on the canvas needs to move. `urgency` is accepted
        for symmetry with the negotiation API and future tuning (e.g. widening the
        search window for more urgent requests); it does not affect this pure
        free-slot search."""
        validate_score("urgency", urgency)
        earliest = earliest or datetime.now()
        horizon_end = earliest + timedelta(days=self.search_horizon_days)
        busy_items = self.canvas.list_between(earliest, horizon_end, exclude_id=exclude_id)
        busy = [(i.start, i.end) for i in busy_items]
        return _find_free_slot(busy, duration, earliest, self.day_start, self.day_end, self.search_horizon_days)

    # ---- negotiation -----------------------------------------------------

    def propose_task(
        self,
        title: str,
        type: ItemType | str,
        start: datetime,
        end: datetime,
        urgency: int,
        inertia: int,
        type_data: Optional[dict[str, Any]] = None,
        exclude_id: Optional[str] = None,
    ) -> SchedulingProposal:
        """Work out what would happen if this item were placed at [start, end),
        without writing anything. Compares the new item's urgency against the
        inertia of whatever it collides with."""
        validate_score("urgency", urgency)
        validate_score("inertia", inertia)
        if end <= start:
            raise ValueError("end must be after start")
        requested = dict(
            title=title,
            type=ItemType(type),
            start=start,
            end=end,
            urgency=urgency,
            inertia=inertia,
            type_data=type_data or {},
        )
        conflicts = self.check_conflict(start, end, exclude_id=exclude_id)
        if not conflicts:
            return SchedulingProposal(decision="direct", requested=requested)

        if all(is_displaceable(urgency, c.inertia, self.displacement_margin) for c in conflicts):
            displacements = self._plan_displacements(conflicts, start, end, exclude_id)
            return SchedulingProposal(
                decision="displace", requested=requested, conflicts=conflicts, displacements=displacements
            )

        alternative = self.find_next_available(end - start, urgency, earliest=start, exclude_id=exclude_id)
        return SchedulingProposal(
            decision="alternative", requested=requested, conflicts=conflicts, alternative_slot=alternative
        )

    def _plan_displacements(
        self,
        conflicts: list[CanvasItem],
        new_start: datetime,
        new_end: datetime,
        exclude_id: Optional[str],
    ) -> list[DisplacementPlan]:
        """Find each displaced item a fresh, fully-free slot after the new item,
        accounting for the other displacements already planned in this same batch."""
        horizon_end = new_start + timedelta(days=self.search_horizon_days)
        surrounding = self.canvas.list_between(new_start, horizon_end, exclude_id=exclude_id)
        moving_ids = {c.id for c in conflicts}
        working_busy = [(i.start, i.end) for i in surrounding if i.id not in moving_ids]
        working_busy.append((new_start, new_end))  # the incoming item claims its slot

        plans: list[DisplacementPlan] = []
        for conflict in conflicts:
            duration = conflict.end - conflict.start
            slot = _find_free_slot(
                working_busy, duration, new_end, self.day_start, self.day_end, self.search_horizon_days
            )
            if slot is None:
                slot = TimeSlot(new_end, new_end + duration)
            plans.append(DisplacementPlan(item=conflict, new_slot=slot))
            working_busy.append((slot.start, slot.end))
        return plans

    def apply_proposal(self, proposal: SchedulingProposal, item_id: Optional[str] = None) -> CanvasItem:
        """Commit a "direct" or "displace" proposal to storage. `item_id` moves an
        existing item (used by move_task); omit it to insert a brand-new item."""
        if proposal.decision not in ("direct", "displace"):
            raise ValueError(f"cannot apply a '{proposal.decision}' proposal; resolve the conflict first")

        for plan in proposal.displacements:
            moved = replace(plan.item, start=plan.new_slot.start, end=plan.new_slot.end)
            self.canvas.update(moved)

        req = proposal.requested
        if item_id is not None:
            existing = self.canvas.get(item_id)
            if existing is None:
                raise KeyError(f"no item with id {item_id}")
            updated = replace(existing, start=req["start"], end=req["end"])
            return self.canvas.update(updated)

        item = CanvasItem(
            id=new_id(),
            title=req["title"],
            type=req["type"],
            start=req["start"],
            end=req["end"],
            urgency=req["urgency"],
            inertia=req["inertia"],
            type_data=req["type_data"],
        )
        return self.canvas.insert(item)

    # ---- entry points ------------------------------------------------------

    def add_task(
        self,
        title: str,
        type: ItemType | str,
        start: datetime,
        end: datetime,
        urgency: int,
        inertia: int,
        type_data: Optional[dict[str, Any]] = None,
        auto_apply_displacement: bool = False,
    ) -> SchedulingProposal:
        """Try to schedule a new item. Commits immediately if the slot is free.
        If it collides with something worth protecting, returns an "alternative"
        proposal instead of writing anything. If it collides only with items that
        are clearly displaceable, it returns a "displace" proposal that is only
        committed when `auto_apply_displacement=True` -- otherwise the caller
        (e.g. the brain layer, after confirming with the user) should apply it
        explicitly via `apply_proposal`."""
        proposal = self.propose_task(title, type, start, end, urgency, inertia, type_data)
        if proposal.decision == "direct" or (proposal.decision == "displace" and auto_apply_displacement):
            item = self.apply_proposal(proposal)
            proposal.requested["id"] = item.id
        return proposal

    def move_task(
        self,
        item_id: str,
        new_start: datetime,
        new_end: datetime,
        auto_apply_displacement: bool = False,
    ) -> SchedulingProposal:
        """Try to move an existing item to a new slot, subject to the same
        negotiation rules as add_task."""
        item = self.canvas.get(item_id)
        if item is None:
            raise KeyError(f"no item with id {item_id}")

        proposal = self.propose_task(
            item.title, item.type, new_start, new_end, item.urgency, item.inertia, item.type_data, exclude_id=item_id
        )
        if proposal.decision == "direct" or (proposal.decision == "displace" and auto_apply_displacement):
            moved_item = self.apply_proposal(proposal, item_id=item_id)
            proposal.requested["id"] = moved_item.id
        return proposal
