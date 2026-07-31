from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


@dataclass
class Tool:
    """A capability the brain can invoke. `parameters` is a JSON schema for the
    input; `handler` is the real Python function that performs the action --
    for the scheduling tools, this is just a thin wrapper around the
    deterministic SchedulingEngine from step 1."""

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]


@dataclass
class ToolCallRecord:
    """What happened when a tool was invoked during one ask() call."""

    name: str
    arguments: dict[str, Any]
    result: Any = None
    error: str | None = None


@dataclass
class Message:
    """One turn of plain conversational history, kept provider-agnostic (no
    tool-use internals) so it can be replayed against any brain adapter."""

    role: str  # "user" | "assistant"
    content: str


@dataclass
class BrainContext:
    system_prompt: str
    history: list[Message] = field(default_factory=list)


@dataclass
class BrainReply:
    response_text: str
    tool_calls: list[ToolCallRecord] = field(default_factory=list)


class BrainAdapter(Protocol):
    """Provider-agnostic interface: swap ClaudeBrain for another provider's
    adapter without touching the rest of the app. Implementations must not do
    any scheduling math themselves -- they only decide which tools to call and
    phrase the results in natural language."""

    def ask(self, user_message: str, available_tools: list[Tool], context: BrainContext) -> BrainReply: ...
