from datetime import datetime

import pytest

from brain.scheduler_tools import build_scheduler_tools
from scheduler import Canvas, SchedulingEngine


@pytest.fixture
def setup():
    canvas = Canvas(":memory:")
    engine = SchedulingEngine(canvas)
    tools = build_scheduler_tools(engine)
    yield engine, {t.name: t for t in tools}
    canvas.close()


def dt(day: int, hour: int, minute: int = 0) -> str:
    return datetime(2026, 8, day, hour, minute).isoformat()


def test_add_task_direct_booking(setup):
    _, tools = setup
    result = tools["add_task"].handler(
        title="Write report", type="task", start=dt(5, 9), end=dt(5, 10), urgency=3, inertia=2
    )
    assert result["decision"] == "direct"
    assert result["committed"] is True
    assert result["item_id"]


def test_get_schedule_returns_serialized_items(setup):
    _, tools = setup
    tools["add_task"].handler(title="Gym", type="task", start=dt(5, 9), end=dt(5, 10), urgency=2, inertia=1)

    result = tools["get_schedule"].handler(date="2026-08-05")
    assert result["date"] == "2026-08-05"
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["title"] == "Gym"
    assert item["type"] == "task"
    assert item["start"] == dt(5, 9)


def test_check_conflict(setup):
    _, tools = setup
    tools["add_task"].handler(title="Gym", type="task", start=dt(5, 9), end=dt(5, 10), urgency=2, inertia=1)

    overlapping = tools["check_conflict"].handler(start=dt(5, 9, 30), end=dt(5, 10, 30))
    assert len(overlapping["conflicts"]) == 1

    clear = tools["check_conflict"].handler(start=dt(5, 10), end=dt(5, 11))
    assert clear["conflicts"] == []


def test_find_next_available(setup):
    _, tools = setup
    tools["add_task"].handler(title="Busy", type="task", start=dt(5, 9), end=dt(5, 10), urgency=3, inertia=3)

    result = tools["find_next_available"].handler(duration_minutes=60, earliest=dt(5, 9))
    assert result["slot"]["start"] == dt(5, 10)


def test_add_task_alternative_does_not_commit(setup):
    _, tools = setup
    tools["add_task"].handler(title="Deadline", type="task", start=dt(5, 9), end=dt(5, 18), urgency=5, inertia=4)

    result = tools["add_task"].handler(
        title="Movie with a friend", type="social", start=dt(5, 14), end=dt(5, 17), urgency=2, inertia=1
    )
    assert result["decision"] == "alternative"
    assert result["committed"] is False
    assert result["item_id"] is None
    assert result["alternative_slot"] is not None


def test_add_task_displace_requires_confirmation(setup):
    _, tools = setup
    low = tools["add_task"].handler(title="Chore", type="task", start=dt(5, 9), end=dt(5, 10), urgency=1, inertia=1)

    proposal = tools["add_task"].handler(
        title="Urgent call", type="task", start=dt(5, 9), end=dt(5, 10), urgency=5, inertia=2
    )
    assert proposal["decision"] == "displace"
    assert proposal["committed"] is False
    assert len(proposal["displacements"]) == 1
    assert proposal["displacements"][0]["item"]["id"] == low["item_id"]

    confirmed = tools["add_task"].handler(
        title="Urgent call", type="task", start=dt(5, 9), end=dt(5, 10), urgency=5, inertia=2,
        confirm_displacement=True,
    )
    assert confirmed["decision"] == "displace"
    assert confirmed["committed"] is True
    assert confirmed["item_id"]


def test_move_task(setup):
    _, tools = setup
    added = tools["add_task"].handler(title="Task", type="task", start=dt(5, 9), end=dt(5, 10), urgency=3, inertia=2)

    moved = tools["move_task"].handler(item_id=added["item_id"], new_start=dt(5, 13), new_end=dt(5, 14))
    assert moved["decision"] == "direct"
    assert moved["committed"] is True
