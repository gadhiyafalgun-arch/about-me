# Life Assistant — Scheduling Engine, Brain Adapter, Nutrition (Steps 1, 2, 4)

A personal life-management assistant that negotiates your schedule instead of just
listing free slots. Step 1 is the deterministic scheduling engine, with no LLM
involved. Step 2 wires an LLM on top to phrase decisions in natural language and
orchestrate them as tool calls — the LLM never does the scheduling math itself; every
urgency/inertia comparison and conflict resolution stays in the engine. Step 4 adds
food/nutrition/supplement tracking as a second goal layer that competes for time the
same way tasks do, rather than a passive log off to the side.

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
  nutrition/
    models.py           # FoodItem, NutritionTargets, MealLog, Supplement, SupplementLogEntry
    storage.py            # SQLite-backed NutritionStore -- extends the same db file as Canvas
    engine.py               # NutritionEngine: log_meal, get_nutrition_status, suggest_meal_slot,
                             # get_pending_supplements, log_supplement_taken, set_targets, ...
  brain/
    types.py           # Tool, ToolCallRecord, BrainContext, BrainReply, BrainAdapter (Protocol)
    claude_adapter.py    # ClaudeBrain: Claude tool-use implementation of BrainAdapter
    scheduler_tools.py    # Wraps the scheduling engine's functions as Tools
    nutrition_tools.py     # Wraps the nutrition engine's functions as Tools
    system_prompt.py       # The brain's system prompt
  chat.py                    # Text-chat CLI: brain -> tools -> engines, end to end
  tests/
    test_engine.py
    test_nutrition_engine.py
    test_scheduler_tools.py
    test_nutrition_tools.py
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

You: log that I ate a chicken salad for lunch
  [tool] log_meal({...}) -> {'totals': {'protein_g': 38, ...}, ...}
Assistant: Logged -- chicken salad, about 420 calories and 38g of protein.

You: am I on track today?
  [tool] get_nutrition_status({...}) -> {'remaining': {'protein_g': 112, ...}, ...}
Assistant: You're at 38g of your 150g protein target so far, with 112g left. It's
mid-afternoon, so there's still time -- want me to fit another meal in?
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

## Nutrition & supplement module

`NutritionEngine` (step 4) extends the same SQLite file the scheduling engine uses
with five more tables (`food_items`, `nutrition_targets`, `meal_log`/`meal_log_items`,
`supplements`, `supplement_log`), and feeds the gap between what's been consumed and
the day's targets into the scheduling engine as *urgency* -- the same currency the
engine already uses for tasks vs. inertia:

- **`log_meal`** records what was actually eaten. Foods are upserted into a reusable
  catalog by name (macros only matter the first time a food is logged -- after that,
  the stored values win over whatever the brain estimates). Since a meal already
  happened, logging it never negotiates or displaces anything: if the time slot is
  free it gets a matching calendar entry, otherwise the nutrition data is still
  recorded but no calendar link is made.
- **`get_nutrition_status`** reports consumed vs. remaining calories/macros against
  the active targets for a date. If no targets have been set yet, it auto-seeds
  generic defaults (flagged `targets_default: true`) so the feature works before the
  user has personalized anything.
- **`suggest_meal_slot`** is `find_next_available` with the urgency computed from the
  nutrition gap instead of passed in: a big remaining protein deficit late in the day
  scores higher than the same deficit at 8am, exactly mirroring how the scheduling
  engine weighs a new item's urgency against an existing item's inertia.
- **`get_pending_supplements`** classifies each dose from a supplement's daily
  schedule as taken / pending / missed by checking for a log entry and comparing the
  scheduled time to now -- nothing is pre-computed or needs a background job.

`set_nutrition_targets`, `add_supplement`, and `log_supplement_taken` aren't in the
engine-function list from the spec, but were added as the minimum necessary to make
the rest of the module usable through the only interface available (chat) --
`get_pending_supplements` is otherwise permanently empty and nutrition status can
never reflect the user's real targets.

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
3. ✅ (folded into step 2) Text chat interface to test negotiation end-to-end.
4. ✅ Nutrition/supplement module as a goal layer feeding the same urgency/inertia
   model, exposed as brain tools in the same chat CLI.
5. Voice layer (STT/TTS) on top of the working text chat brain.
6. PWA frontend with a calendar-style canvas view.
7. Google Calendar sync.
