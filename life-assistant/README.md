# Life Assistant — Scheduling Engine (Step 1)

A personal life-management assistant that negotiates your schedule instead of just
listing free slots. This is step 1 of the build: the deterministic scheduling engine,
with no LLM involved. Every decision here is plain, testable Python — later steps
wire an LLM on top to phrase these decisions in natural language and orchestrate them
as tool calls, but the LLM never does the scheduling math itself.

## Core model

Every item on the canvas (tasks, sleep, meals, meetings, supplements, social plans...)
carries two 1–5 scores:

- **urgency** — how time-sensitive the item is.
- **inertia** — how costly it is to move. Sleep is high-inertia but not immutable;
  a low-priority task is near-zero inertia.

Nothing is a hard-fixed block. When a new request collides with something already on
the canvas, the engine compares the new item's urgency against the inertia of whatever
it collides with:

- If the new urgency **clearly outweighs** every conflicting item's inertia (by a
  configurable margin, default 2 points), the engine proposes displacing those items
  and cascades each one to its own next free slot.
- Otherwise, nothing existing is touched — the engine looks for the next slot where
  nothing needs to move at all, and offers that instead.

Nothing is committed to storage during this evaluation. A `SchedulingProposal` describes
what *would* happen; committing it is a separate, explicit step (`apply_proposal`, or
`auto_apply_displacement=True` on `add_task`/`move_task`). This is what makes
negotiation possible: the brain/UI layer gets to show the user the tradeoff and ask
"want me to make space?" before anything actually moves.

## Layout

```
life-assistant/
  scheduler/
    models.py   # CanvasItem, TimeSlot, SchedulingProposal, DisplacementPlan, enums
    storage.py  # SQLite-backed Canvas (CRUD + overlap queries)
    engine.py   # SchedulingEngine: get_schedule, check_conflict, find_next_available,
                # add_task, move_task, propose_task, apply_proposal
  tests/
    test_engine.py
```

## Running the tests

```bash
pip install -r requirements.txt
pytest
```

## API sketch

```python
from datetime import datetime, timedelta
from scheduler import create_engine, ItemType

engine = create_engine("canvas.db")

# Straightforward add: no conflicts, commits immediately.
engine.add_task("Write report", ItemType.TASK, start, end, urgency=3, inertia=2)

# Ask what would happen without committing anything.
proposal = engine.propose_task("Movie with a friend", ItemType.SOCIAL, start, end,
                                urgency=2, inertia=1)
if proposal.decision == "alternative":
    # proposal.alternative_slot is a fully free TimeSlot elsewhere.
    ...
elif proposal.decision == "displace":
    # proposal.displacements lists what would move and where -- present this to
    # the user, and only call engine.apply_proposal(proposal) once they say yes.
    ...
```

## Roadmap

1. ✅ Scheduling engine (this step): canvas data model, urgency/inertia negotiation,
   conflict resolution, SQLite storage.
2. Brain adapter layer: `brain.ask(user_message, available_tools, context)`, Claude
   adapter using these engine functions as tools.
3. Text chat interface to test negotiation end-to-end.
4. Nutrition/supplement module as a goal layer feeding the same urgency/inertia model.
5. Voice layer (STT/TTS) on top of the working text chat brain.
6. PWA frontend with a calendar-style canvas view.
7. Google Calendar sync.
