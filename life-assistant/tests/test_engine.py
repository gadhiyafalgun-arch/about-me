from datetime import datetime, time, timedelta

import pytest

from scheduler import Canvas, ItemType, SchedulingEngine


@pytest.fixture
def engine():
    canvas = Canvas(":memory:")
    yield SchedulingEngine(canvas)
    canvas.close()


def dt(day: int, hour: int, minute: int = 0) -> datetime:
    """Shorthand for a datetime on July <day> 2026, so tests read like a calendar."""
    return datetime(2026, 7, day, hour, minute)


# ---- get_schedule / check_conflict --------------------------------------------


def test_add_task_with_no_conflict_schedules_directly(engine):
    proposal = engine.add_task(
        "Write report", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=3, inertia=2
    )
    assert proposal.decision == "direct"

    items = engine.get_schedule(dt(1, 0).date())
    assert len(items) == 1
    assert items[0].title == "Write report"


def test_check_conflict_detects_overlap_and_ignores_non_overlap(engine):
    engine.add_task("Gym", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=2, inertia=1)

    overlapping = engine.check_conflict(dt(1, 9, 30), dt(1, 10, 30))
    assert len(overlapping) == 1
    assert overlapping[0].title == "Gym"

    non_overlapping = engine.check_conflict(dt(1, 10), dt(1, 11))
    assert non_overlapping == []


def test_get_schedule_only_returns_items_on_that_day(engine):
    engine.add_task("Day one task", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=3, inertia=2)
    engine.add_task("Day two task", ItemType.TASK, dt(2, 9), dt(2, 10), urgency=3, inertia=2)

    day_one = engine.get_schedule(dt(1, 0).date())
    assert [i.title for i in day_one] == ["Day one task"]


# ---- find_next_available -------------------------------------------------------


def test_find_next_available_on_empty_schedule_returns_earliest_requested_time(engine):
    slot = engine.find_next_available(timedelta(hours=1), urgency=3, earliest=dt(1, 9))
    assert slot.start == dt(1, 9)
    assert slot.end == dt(1, 10)


def test_find_next_available_skips_busy_block(engine):
    engine.add_task("Meeting", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=3, inertia=3)

    slot = engine.find_next_available(timedelta(hours=1), urgency=3, earliest=dt(1, 9))
    assert slot.start == dt(1, 10)
    assert slot.end == dt(1, 11)


def test_find_next_available_rolls_over_to_next_day_within_working_hours(engine):
    # Book the entire working window on day 1.
    engine.add_task("All day", ItemType.TASK, dt(1, 7), dt(1, 23), urgency=3, inertia=3)

    slot = engine.find_next_available(timedelta(hours=1), urgency=3, earliest=dt(1, 9))
    assert slot.start == dt(2, 7)
    assert slot.end == dt(2, 8)


# ---- negotiation: displacement vs. alternative ---------------------------------


def test_high_urgency_displaces_low_inertia_conflict(engine):
    low = engine.add_task(
        "Sort emails", ItemType.TASK, dt(1, 14), dt(1, 15), urgency=2, inertia=1
    )
    low_id = low.requested["id"]

    proposal = engine.add_task(
        "Fix production outage",
        ItemType.TASK,
        dt(1, 14),
        dt(1, 15),
        urgency=5,
        inertia=4,
        auto_apply_displacement=True,
    )

    assert proposal.decision == "displace"
    assert len(proposal.displacements) == 1
    assert proposal.displacements[0].item.id == low_id

    # The urgent item took the requested slot.
    day = engine.get_schedule(dt(1, 0).date())
    urgent_item = next(i for i in day if i.title == "Fix production outage")
    assert (urgent_item.start, urgent_item.end) == (dt(1, 14), dt(1, 15))

    # The bumped item moved elsewhere and no longer overlaps.
    bumped_item = next(i for i in day if i.id == low_id)
    assert not (bumped_item.start < urgent_item.end and urgent_item.start < bumped_item.end)


def test_low_urgency_request_gets_alternative_instead_of_bumping_high_inertia(engine):
    # The "movie on Wednesday" scenario: three high-priority, high-inertia tasks
    # fill Wednesday; a casual social request should be redirected, not bump them.
    engine.add_task("Deadline A", ItemType.TASK, dt(1, 9), dt(1, 12), urgency=5, inertia=4)
    engine.add_task("Deadline B", ItemType.TASK, dt(1, 12), dt(1, 15), urgency=5, inertia=4)
    engine.add_task("Deadline C", ItemType.TASK, dt(1, 15), dt(1, 18), urgency=5, inertia=4)

    proposal = engine.add_task(
        "Movie with a friend",
        ItemType.SOCIAL,
        dt(1, 14),
        dt(1, 17),
        urgency=2,
        inertia=1,
        auto_apply_displacement=True,
    )

    assert proposal.decision == "alternative"
    assert len(proposal.conflicts) == 2  # Deadline B and Deadline C overlap 14:00-17:00
    assert proposal.alternative_slot is not None
    # Nothing was written -- Wednesday's tasks are untouched, movie was not scheduled.
    wednesday = engine.get_schedule(dt(1, 0).date())
    assert {i.title for i in wednesday} == {"Deadline A", "Deadline B", "Deadline C"}

    # The suggested alternative is actually free.
    alt = proposal.alternative_slot
    assert engine.check_conflict(alt.start, alt.end) == []


def test_alternative_slot_can_then_be_booked_directly(engine):
    engine.add_task("Deadline A", ItemType.TASK, dt(1, 9), dt(1, 18), urgency=5, inertia=4)

    proposal = engine.add_task(
        "Movie with a friend", ItemType.SOCIAL, dt(1, 14), dt(1, 17), urgency=2, inertia=1
    )
    assert proposal.decision == "alternative"
    alt = proposal.alternative_slot

    follow_up = engine.add_task(
        "Movie with a friend", ItemType.SOCIAL, alt.start, alt.end, urgency=2, inertia=1
    )
    assert follow_up.decision == "direct"


def test_partial_displaceability_falls_back_to_alternative(engine):
    # One conflict is displaceable, the other is not -- the whole slot should be
    # rejected rather than half-cleared. The two pre-existing items are back-to-back
    # (not overlapping each other) so both schedule directly, then the new request
    # spans both of them.
    engine.add_task("Low priority chore", ItemType.TASK, dt(1, 9), dt(1, 9, 30), urgency=1, inertia=1)
    engine.add_task("Sleep", ItemType.SLEEP, dt(1, 9, 30), dt(1, 10, 30), urgency=3, inertia=5)

    proposal = engine.add_task(
        "Urgent call", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=5, inertia=4
    )

    assert proposal.decision == "alternative"
    day = engine.get_schedule(dt(1, 0).date())
    assert len(day) == 2  # nothing displaced, nothing new added


def test_displace_proposal_not_applied_without_auto_apply_flag(engine):
    low = engine.add_task("Low priority chore", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=1, inertia=1)

    proposal = engine.add_task(
        "Urgent call", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=5, inertia=2
    )

    assert proposal.decision == "displace"
    # Not applied: the original item is untouched and the urgent one wasn't written.
    day = engine.get_schedule(dt(1, 0).date())
    assert len(day) == 1
    assert day[0].id == low.requested["id"]
    assert (day[0].start, day[0].end) == (dt(1, 9), dt(1, 10))


def test_apply_proposal_commits_a_previously_computed_displace_decision(engine):
    engine.add_task("Low priority chore", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=1, inertia=1)

    proposal = engine.add_task("Urgent call", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=5, inertia=2)
    assert proposal.decision == "displace"

    item = engine.apply_proposal(proposal)
    assert (item.start, item.end) == (dt(1, 9), dt(1, 10))
    assert len(engine.get_schedule(dt(1, 0).date())) == 2


# ---- move_task ------------------------------------------------------------------


def test_move_task_to_free_slot(engine):
    added = engine.add_task("Task", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=3, inertia=2)
    item_id = added.requested["id"]

    proposal = engine.move_task(item_id, dt(1, 13), dt(1, 14))
    assert proposal.decision == "direct"

    moved = engine.canvas.get(item_id)
    assert (moved.start, moved.end) == (dt(1, 13), dt(1, 14))


def test_move_task_into_conflict_uses_same_negotiation_rules(engine):
    blocker = engine.add_task("Important meeting", ItemType.MEETING, dt(1, 13), dt(1, 14), urgency=5, inertia=5)
    mover = engine.add_task("Chore", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=2, inertia=1)
    mover_id = mover.requested["id"]

    proposal = engine.move_task(mover_id, dt(1, 13), dt(1, 14))
    assert proposal.decision == "alternative"

    # Nothing moved -- both items are where they started.
    unmoved = engine.canvas.get(mover_id)
    assert (unmoved.start, unmoved.end) == (dt(1, 9), dt(1, 10))
    blocker_item = engine.canvas.get(blocker.requested["id"])
    assert (blocker_item.start, blocker_item.end) == (dt(1, 13), dt(1, 14))


def test_move_task_raises_for_unknown_id(engine):
    with pytest.raises(KeyError):
        engine.move_task("does-not-exist", dt(1, 9), dt(1, 10))


# ---- validation ------------------------------------------------------------------


@pytest.mark.parametrize("urgency,inertia", [(0, 3), (6, 3), (3, 0), (3, 6)])
def test_out_of_range_scores_are_rejected(engine, urgency, inertia):
    with pytest.raises(ValueError):
        engine.add_task("Bad scores", ItemType.TASK, dt(1, 9), dt(1, 10), urgency=urgency, inertia=inertia)


def test_end_before_start_is_rejected(engine):
    with pytest.raises(ValueError):
        engine.propose_task("Backwards", ItemType.TASK, dt(1, 10), dt(1, 9), urgency=3, inertia=3)


# ---- search-horizon boundary correctness ----------------------------------------


def test_horizon_end_covers_the_full_last_scanned_day():
    from scheduler.engine import _horizon_end

    # A late clock time on the reference day stresses the boundary: naively adding
    # `horizon_days` as a raw timedelta (rather than aligning to day_end on the
    # target date) would land short of the last day _find_free_slot can scan.
    reference = datetime(2026, 3, 1, 22, 30)
    horizon_end = _horizon_end(reference, horizon_days=2, day_end=time(23, 0))

    last_scanned_day = reference.date() + timedelta(days=1)  # horizon_days=2 -> offsets 0,1
    last_scanned_window_end = datetime.combine(last_scanned_day, time(23, 0))
    assert horizon_end >= last_scanned_window_end
    assert horizon_end == datetime(2026, 3, 3, 23, 0)


def test_displacement_search_does_not_miss_conflicts_near_the_horizon_when_new_item_spans_midnight():
    """Regression test: _plan_displacements used to compute its busy-items query
    horizon from the new item's *start*, while the search itself scans starting at
    the new item's *end*. Those only ever diverge when the new item spans midnight
    (e.g. negotiating around a sleep block, or an overnight task) -- in which case
    the query could end a full day earlier than the last day actually scanned,
    hiding a real conflict near that boundary and letting the engine propose a
    displacement slot that collided with it."""
    canvas = Canvas(":memory:")
    engine = SchedulingEngine(canvas, day_start=time(0, 0), day_end=time(23, 59), search_horizon_days=3)

    day0 = datetime(2026, 3, 1)
    day1 = datetime(2026, 3, 2)
    day3 = datetime(2026, 3, 4)

    low = engine.add_task(
        "Low priority chore", ItemType.TASK, day0 + timedelta(hours=12), day0 + timedelta(hours=13),
        urgency=1, inertia=1,
    )
    # Occupies nearly the whole search window, forcing the displacement search all
    # the way out to the last day _find_free_slot scans.
    engine.add_task(
        "Big blocker", ItemType.TASK, day1 + timedelta(minutes=30), day3 + timedelta(hours=22),
        urgency=1, inertia=1,
    )
    # Sits exactly in the gap the old (buggy) horizon would have missed: past
    # `new_start + search_horizon_days`, but still within the last day the scan
    # actually covers once anchored to `new_end`.
    engine.add_task(
        "Hidden conflict", ItemType.TASK, day3 + timedelta(hours=22), day3 + timedelta(hours=22, minutes=30),
        urgency=1, inertia=1,
    )

    # Spans midnight -- this is what makes _plan_displacements search from a
    # different reference point (new_end) than the old horizon calculation used
    # (new_start).
    proposal = engine.add_task(
        "Urgent overnight task", ItemType.TASK, day0 + timedelta(hours=12), day1 + timedelta(minutes=30),
        urgency=5, inertia=4,
    )

    assert proposal.decision == "displace"
    assert len(proposal.displacements) == 1
    plan = proposal.displacements[0]
    assert plan.item.id == low.requested["id"]

    conflicts_at_new_slot = engine.check_conflict(plan.new_slot.start, plan.new_slot.end, exclude_id=plan.item.id)
    assert conflicts_at_new_slot == []

    canvas.close()
