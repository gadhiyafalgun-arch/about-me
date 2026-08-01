"""Tests for the Claude tool-use orchestration loop, using a fake Anthropic client
so they run with no network access and no API key. These verify the *loop
mechanics* (tool_use -> tool_result round trips, iteration cap, error handling) --
never actual model behavior, which can't be tested deterministically."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import pytest

from brain.claude_adapter import DEFAULT_MODEL, MAX_TOOL_ITERATIONS, ClaudeBrain, _format_date_grounding
from brain.nutrition_tools import build_nutrition_tools
from brain.scheduler_tools import build_scheduler_tools
from brain.types import BrainContext, Tool
from nutrition import NutritionEngine, NutritionStore
from scheduler import Canvas, SchedulingEngine


@dataclass
class FakeTextBlock:
    text: str
    type: str = "text"


@dataclass
class FakeToolUseBlock:
    id: str
    name: str
    input: dict
    type: str = "tool_use"


@dataclass
class FakeResponse:
    content: list
    stop_reason: str = "end_turn"


class FakeMessagesEndpoint:
    def __init__(self, responses: list[FakeResponse]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs):
        # Snapshot messages -- ClaudeBrain mutates the same list object across
        # iterations, so storing the raw reference would show every past call
        # as the *final* state instead of what was actually sent at the time.
        self.calls.append({**kwargs, "messages": list(kwargs.get("messages", []))})
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses: list[FakeResponse]):
        self.messages = FakeMessagesEndpoint(responses)


def make_tool(name="add", handler=None):
    return Tool(
        name=name,
        description="test tool",
        parameters={"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}},
        handler=handler or (lambda a, b: a + b),
    )


def test_direct_text_response_with_no_tool_use():
    client = FakeClient([FakeResponse(content=[FakeTextBlock("Hello there!")], stop_reason="end_turn")])
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("hi", [make_tool()], context)

    assert reply.response_text == "Hello there!"
    assert reply.tool_calls == []
    # The system prompt now carries fresh date grounding ahead of the caller's text.
    assert client.messages.calls[0]["system"].endswith("sys")
    assert client.messages.calls[0]["messages"][-1] == {"role": "user", "content": "hi"}


def test_tool_use_round_trip_then_final_text():
    client = FakeClient(
        [
            FakeResponse(
                content=[
                    FakeTextBlock("Let me compute that."),
                    FakeToolUseBlock(id="toolu_1", name="add", input={"a": 2, "b": 3}),
                ],
                stop_reason="tool_use",
            ),
            FakeResponse(content=[FakeTextBlock("The answer is 5.")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("what is 2+3?", [make_tool()], context)

    assert reply.response_text == "The answer is 5."
    assert len(reply.tool_calls) == 1
    call = reply.tool_calls[0]
    assert call.name == "add"
    assert call.arguments == {"a": 2, "b": 3}
    assert call.result == 5
    assert call.error is None

    # Second request must carry the assistant's tool_use turn and a matching tool_result.
    second_call_messages = client.messages.calls[1]["messages"]
    assistant_turn = second_call_messages[-2]
    tool_result_turn = second_call_messages[-1]
    assert assistant_turn["role"] == "assistant"
    assert tool_result_turn["role"] == "user"
    assert tool_result_turn["content"][0]["tool_use_id"] == "toolu_1"
    assert tool_result_turn["content"][0]["is_error"] is False


def test_unknown_tool_reports_error_without_crashing():
    client = FakeClient(
        [
            FakeResponse(
                content=[FakeToolUseBlock(id="toolu_1", name="does_not_exist", input={})],
                stop_reason="tool_use",
            ),
            FakeResponse(content=[FakeTextBlock("Sorted.")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("do something", [make_tool()], context)

    assert reply.tool_calls[0].error == "unknown tool 'does_not_exist'"
    tool_result = client.messages.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True


def test_tool_handler_exception_is_caught_and_reported():
    def boom(a, b):
        raise ValueError("bad input")

    client = FakeClient(
        [
            FakeResponse(
                content=[FakeToolUseBlock(id="toolu_1", name="add", input={"a": 1, "b": 2})],
                stop_reason="tool_use",
            ),
            FakeResponse(content=[FakeTextBlock("Handled the error.")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("do it", [make_tool(handler=boom)], context)

    assert reply.tool_calls[0].error == "bad input"
    assert reply.tool_calls[0].result is None
    tool_result = client.messages.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True


def test_iteration_cap_stops_infinite_tool_loop():
    # Every single response keeps requesting the same tool -- never a final answer.
    responses = [
        FakeResponse(
            content=[FakeToolUseBlock(id=f"toolu_{i}", name="add", input={"a": i, "b": 1})],
            stop_reason="tool_use",
        )
        for i in range(MAX_TOOL_ITERATIONS)
    ]
    client = FakeClient(responses)
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("loop forever", [make_tool()], context)

    assert len(client.messages.calls) == MAX_TOOL_ITERATIONS
    assert "tool-call limit" in reply.response_text
    assert len(reply.tool_calls) == MAX_TOOL_ITERATIONS


def test_refusal_stop_reason_handled_gracefully():
    client = FakeClient([FakeResponse(content=[], stop_reason="refusal")])
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("something disallowed", [make_tool()], context)

    assert reply.response_text == "I can't help with that request."
    assert reply.tool_calls == []


def test_default_model_is_sonnet():
    assert DEFAULT_MODEL == "claude-sonnet-5"

    client = FakeClient([FakeResponse(content=[FakeTextBlock("hi")], stop_reason="end_turn")])
    brain = ClaudeBrain(client=client)
    brain.ask("hello", [make_tool()], BrainContext(system_prompt="sys"))

    assert client.messages.calls[0]["model"] == "claude-sonnet-5"


def test_instance_level_model_override():
    client = FakeClient([FakeResponse(content=[FakeTextBlock("hi")], stop_reason="end_turn")])
    brain = ClaudeBrain(client=client, model="claude-opus-5")
    brain.ask("hello", [make_tool()], BrainContext(system_prompt="sys"))

    assert client.messages.calls[0]["model"] == "claude-opus-5"


def test_per_call_model_override_escalates_without_changing_instance_default():
    client = FakeClient(
        [
            FakeResponse(content=[FakeTextBlock("easy answer")], stop_reason="end_turn"),
            FakeResponse(content=[FakeTextBlock("hard answer")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    brain.ask("a routine question", [make_tool()], context)
    brain.ask("a hard reasoning task", [make_tool()], context, model="claude-opus-5")

    assert client.messages.calls[0]["model"] == "claude-sonnet-5"
    assert client.messages.calls[1]["model"] == "claude-opus-5"
    assert brain.model == "claude-sonnet-5"  # the instance default is untouched


# ---- current-date grounding -----------------------------------------------------


def test_format_date_grounding_reports_the_given_date_verbatim():
    fixed = datetime(2026, 8, 2, 14, 30)  # a Sunday

    grounding = _format_date_grounding(fixed)

    assert "2026-08-02" in grounding
    assert "Sunday" in grounding
    assert "14:30" in grounding


def test_ask_grounds_the_system_prompt_in_the_injected_clock_each_turn():
    """The system prompt sent to the model must reflect the clock passed to
    ClaudeBrain, not real wall-clock time -- this is what makes date resolution
    deterministic and testable instead of depending on the model's own
    (unreliable) sense of "now"."""
    fixed_now = datetime(2026, 8, 2, 9, 0)
    client = FakeClient([FakeResponse(content=[FakeTextBlock("ok")], stop_reason="end_turn")])
    brain = ClaudeBrain(client=client, clock=lambda: fixed_now)
    context = BrainContext(system_prompt="sys")

    brain.ask("what's on my plate today?", [make_tool()], context)

    system_sent = client.messages.calls[0]["system"]
    assert "2026-08-02" in system_sent
    assert system_sent.endswith("sys")  # caller's own instructions still follow the grounding


def test_relative_date_tool_call_resolves_against_the_injected_current_date():
    """End-to-end regression for the "tomorrow" bug: with "today" fixed via a
    mocked clock, a tool call resolving "tomorrow" (as a correctly-grounded
    model would produce) must land the item on the real next calendar date on
    the actual scheduling engine -- not some other, ungrounded guess."""
    fixed_today = datetime(2026, 8, 1, 9, 0)  # a Saturday
    tomorrow = fixed_today.date() + timedelta(days=1)

    canvas = Canvas(":memory:")
    engine = SchedulingEngine(canvas)
    tools = build_scheduler_tools(engine)

    tool_call_args = {
        "title": "Deep work",
        "type": "task",
        "start": f"{tomorrow.isoformat()}T14:00:00",
        "end": f"{tomorrow.isoformat()}T16:00:00",
        "urgency": 3,
        "inertia": 2,
    }
    client = FakeClient(
        [
            FakeResponse(
                content=[FakeToolUseBlock(id="toolu_1", name="add_task", input=tool_call_args)],
                stop_reason="tool_use",
            ),
            FakeResponse(content=[FakeTextBlock("Booked 2 hours tomorrow afternoon.")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client, clock=lambda: fixed_today)
    context = BrainContext(system_prompt="sys")

    reply = brain.ask("I need 2 hours tomorrow afternoon", tools, context)

    # The model was grounded in the fixed "today" for this turn...
    assert fixed_today.strftime("%Y-%m-%d") in client.messages.calls[0]["system"]

    # ...and the tool call that resolved "tomorrow" against it actually booked
    # the item on the real engine, on the real next calendar date.
    assert reply.tool_calls[0].result["decision"] == "direct"
    scheduled = engine.get_schedule(tomorrow)
    assert len(scheduled) == 1
    assert scheduled[0].title == "Deep work"

    canvas.close()


# ---- duplicate log_meal across unrelated turns ----------------------------------


def test_log_meal_is_not_repeated_on_later_unrelated_turns(tmp_path):
    """Regression for a real bug: log_meal fired again on later, unrelated turns
    ("find time tomorrow", "am I on track today?") because context.history only
    ever kept the final narrative reply, never a record of which tool calls had
    actually succeeded. The original "I ate a chicken salad" message legitimately
    stays in history forever (that's normal conversational continuity) -- but
    without a clear "already logged" record alongside it, a model re-reading that
    stale mention on a later turn can decide to log it again "just in case".

    This scripts a minimal fake client that reproduces exactly that failure mode:
    it re-calls log_meal on any turn where the meal is mentioned anywhere in
    history *unless* it also finds a record that log_meal already completed for
    it. Asserts log_meal fires exactly once across three turns, and that the real
    NutritionEngine ends up with exactly one meal logged, not three."""
    db_path = str(tmp_path / "canvas.db")
    canvas = Canvas(db_path)
    scheduling_engine = SchedulingEngine(canvas)
    store = NutritionStore(db_path)
    nutrition_engine = NutritionEngine(store, scheduling_engine)
    tools = build_nutrition_tools(nutrition_engine)

    meal_time = datetime(2026, 8, 1, 12, 30)

    class ScriptedNutritionClient:
        """Stand-in for a model that would re-log a meal any time it's still
        mentioned in history, unless that history also clearly shows it was
        already logged successfully."""

        def __init__(self):
            self.messages = self
            self.calls: list[dict[str, Any]] = []

        def create(self, **kwargs):
            self.calls.append({**kwargs, "messages": list(kwargs.get("messages", []))})
            messages = kwargs["messages"]
            last = messages[-1]

            if isinstance(last["content"], list):
                # A tool_result reply within the same turn -- just wrap up with text.
                return FakeResponse(content=[FakeTextBlock("Okay.")], stop_reason="end_turn")

            user_text = last["content"]
            history_text = "\n".join(m["content"] for m in messages[:-1] if isinstance(m["content"], str))
            meal_confirmed_done = "log_meal already completed successfully" in history_text
            meal_mentioned = "chicken salad" in user_text.lower() or "chicken salad" in history_text.lower()

            if meal_mentioned and not meal_confirmed_done:
                return FakeResponse(
                    content=[
                        FakeToolUseBlock(
                            id=f"toolu_{len(self.calls)}",
                            name="log_meal",
                            input={
                                "foods": [
                                    {"name": "chicken salad", "calories": 450, "protein_g": 35, "carbs_g": 20, "fat_g": 22}
                                ],
                                "eaten_at": meal_time.isoformat(),
                            },
                        )
                    ],
                    stop_reason="tool_use",
                )
            return FakeResponse(content=[FakeTextBlock("Here you go.")], stop_reason="end_turn")

    client = ScriptedNutritionClient()
    brain = ClaudeBrain(client=client, clock=lambda: meal_time)
    context = BrainContext(system_prompt="sys")

    reply1 = brain.ask("I ate a chicken salad for lunch", tools, context)
    reply2 = brain.ask("find time tomorrow for a workout", tools, context)
    reply3 = brain.ask("am I on track today?", tools, context)

    all_tool_calls = reply1.tool_calls + reply2.tool_calls + reply3.tool_calls
    log_meal_calls = [c for c in all_tool_calls if c.name == "log_meal"]
    assert len(log_meal_calls) == 1

    status = nutrition_engine.get_nutrition_status(meal_time.date())
    assert status["meals_logged"] == 1

    store.close()
    canvas.close()


def test_context_history_persists_across_turns():
    client = FakeClient(
        [
            FakeResponse(content=[FakeTextBlock("Nice to meet you, Alice.")], stop_reason="end_turn"),
            FakeResponse(content=[FakeTextBlock("Your name is Alice.")], stop_reason="end_turn"),
        ]
    )
    brain = ClaudeBrain(client=client)
    context = BrainContext(system_prompt="sys")

    brain.ask("My name is Alice.", [make_tool()], context)
    brain.ask("What's my name?", [make_tool()], context)

    second_request_messages = client.messages.calls[1]["messages"]
    assert second_request_messages[0] == {"role": "user", "content": "My name is Alice."}
    assert second_request_messages[1] == {"role": "assistant", "content": "Nice to meet you, Alice."}
    assert second_request_messages[2] == {"role": "user", "content": "What's my name?"}
