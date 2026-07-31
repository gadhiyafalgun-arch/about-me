# Life Assistant — Scheduling Engine + Brain Adapter (Steps 1-2)

A personal life-management assistant that negotiates your schedule instead of just
listing free slots. Step 1 is the deterministic scheduling engine, with no LLM
involved. Step 2 wires an LLM on top to phrase decisions in natural language and
orchestrate them as tool calls — the LLM never does the scheduling math itself; every
urgency/inertia comparison and conflict resolution stays in the engine.

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
    models.py       # CanvasItem, TimeSlot, SchedulingProposal, DisplacementPlan, enums
    storage.py       # SQLite-backed Canvas (CRUD + overlap queries)
    engine.py         # SchedulingEngine: get_schedule, check_conflict, find_next_available,
                       # add_task, move_task, propose_task, apply_proposal
  brain/
    types.py           # Tool, ToolCallRecord, BrainContext, BrainReply, BrainAdapter (Protocol)
    claude_adapter.py    # ClaudeBrain: Claude tool-use implementation of BrainAdapter
    scheduler_tools.py    # Wraps the engine's functions as Tools the brain can call
    system_prompt.py       # The brain's system prompt
  chat.py                    # Text-chat CLI: brain -> tools -> engine, end to end
  tests/
    test_engine.py
    test_scheduler_tools.py
    test_claude_adapter.py    # Orchestration-loop tests against a fake client (no API key needed)
```

## Running the tests

```bash
pip install -r requirements.txt
pytest
```

## Trying the chat CLI

```bash
export ANTHROPIC_API_KEY=...
python chat.py
```

```
You: can I do a movie Wednesday with a friend?
  [tool] add_task({...}) -> {'decision': 'alternative', ...}
Assistant: Wednesday's packed with a couple of deadline-driven tasks I don't want to
bump, but Friday afternoon is wide open -- want me to book the movie there instead?
```

## Brain adapter layer

`brain.ask(user_message, available_tools, context) -> BrainReply(response_text, tool_calls)`
is the provider-agnostic interface (`brain/types.py`). `ClaudeBrain` is the first
implementation: it translates `Tool` objects into Claude's `input_schema` format, runs
the tool-use loop (call Claude -> execute any requested tools -> feed `tool_result`s
back -> repeat until Claude stops asking for tools), and returns the final text plus a
log of every tool call made. A future provider only needs to implement the same
`ask()` signature -- nothing else in the app changes.

The five scheduling tools (`get_schedule`, `check_conflict`, `find_next_available`,
`add_task`, `move_task`) are thin wrappers: they parse ISO strings into
dates/datetimes, call straight into the step-1 `SchedulingEngine`, and serialize the
result back to JSON-friendly dicts. `add_task`/`move_task` expose a
`confirm_displacement` flag so the negotiation stays two-step: the brain calls once
without it to see the proposal (`decision: "displace"` lists what *would* move),
explains the tradeoff, and only calls again with `confirm_displacement=true` once the
user agrees -- nothing is bumped without that confirmation.

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

1. ✅ Scheduling engine: canvas data model, urgency/inertia negotiation, conflict
   resolution, SQLite storage.
2. ✅ Brain adapter layer: provider-agnostic `brain.ask(...)` interface, Claude
   adapter using the engine's functions as tools, and a text-chat CLI to exercise
   the negotiation loop end to end.
3. Nutrition/supplement module as a goal layer feeding the same urgency/inertia model.
4. Voice layer (STT/TTS) on top of the working text chat brain.
5. PWA frontend with a calendar-style canvas view.
6. Google Calendar sync.
