"""Tests for the Claude tool-use orchestration loop, using a fake Anthropic client
so they run with no network access and no API key. These verify the *loop
mechanics* (tool_use -> tool_result round trips, iteration cap, error handling) --
never actual model behavior, which can't be tested deterministically."""

from dataclasses import dataclass, field
from typing import Any

import pytest

from brain.claude_adapter import DEFAULT_MODEL, MAX_TOOL_ITERATIONS, ClaudeBrain
from brain.types import BrainContext, Tool


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
    assert client.messages.calls[0]["system"] == "sys"
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
