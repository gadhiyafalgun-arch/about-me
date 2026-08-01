from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Callable, Optional

from .types import BrainContext, BrainReply, Message, Tool, ToolCallRecord

DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_MAX_TOKENS = 2048
DEFAULT_EFFORT = "medium"
MAX_TOOL_ITERATIONS = 8


def _tool_schema(tool: Tool) -> dict[str, Any]:
    return {"name": tool.name, "description": tool.description, "input_schema": tool.parameters}


def _default_clock() -> datetime:
    return datetime.now().astimezone()


def _format_date_grounding(current_dt: datetime) -> str:
    """Ground the model in the real current date/time, pulled from the system clock
    at the start of this turn -- never left for the model to infer from its own
    (frozen, possibly stale) sense of "now"."""
    tz_label = current_dt.tzname() or "local time"
    return (
        f"Today's date is {current_dt.strftime('%Y-%m-%d')} ({current_dt.strftime('%A')}), and the "
        f"current time is {current_dt.strftime('%H:%M')} {tz_label}. This is the real current date "
        "and time, read from the system clock -- not a guess and not your training cutoff. Resolve "
        "every relative date or time phrase (\"today\", \"tomorrow\", \"this week\", \"next Friday\", "
        "etc.) against this exact date before calling any tool that takes a date or datetime."
    )


class ClaudeBrain:
    """Claude tool-use implementation of the BrainAdapter interface (see types.py).

    All scheduling math lives in the engine's tools; this class only decides which
    tools to call (via Claude) and turns the structured results into natural
    language. It never computes urgency/inertia/conflicts itself.
    """

    def __init__(
        self,
        client: Optional[Any] = None,
        model: str = DEFAULT_MODEL,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        effort: str = DEFAULT_EFFORT,
        clock: Callable[[], datetime] = _default_clock,
    ):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client
        self.model = model
        self.max_tokens = max_tokens
        self.effort = effort
        self.clock = clock

    def ask(
        self,
        user_message: str,
        available_tools: list[Tool],
        context: BrainContext,
        model: Optional[str] = None,
    ) -> BrainReply:
        """`model` overrides the instance default for this call only -- e.g. pass
        "claude-opus-5" to escalate a single hard-reasoning request without creating
        a separate ClaudeBrain."""
        tools_by_name = {t.name: t for t in available_tools}
        tool_schemas = [_tool_schema(t) for t in available_tools]

        # Read the clock once, at the start of this turn -- never reused across turns,
        # so a long-lived chat session can't drift onto a stale "today".
        system = f"{_format_date_grounding(self.clock())}\n\n{context.system_prompt}"

        messages: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in context.history]
        messages.append({"role": "user", "content": user_message})

        tool_calls: list[ToolCallRecord] = []
        response_text = ""

        for _ in range(MAX_TOOL_ITERATIONS):
            response = self.client.messages.create(
                model=model or self.model,
                max_tokens=self.max_tokens,
                system=system,
                tools=tool_schemas,
                messages=messages,
                output_config={"effort": self.effort},
            )

            if response.stop_reason == "refusal":
                response_text = "I can't help with that request."
                break

            text_parts = [block.text for block in response.content if block.type == "text"]
            response_text = "\n".join(part for part in text_parts if part)

            tool_use_blocks = [block for block in response.content if block.type == "tool_use"]
            messages.append({"role": "assistant", "content": response.content})

            if not tool_use_blocks:
                break

            tool_results = []
            for block in tool_use_blocks:
                tool = tools_by_name.get(block.name)
                if tool is None:
                    result, error = None, f"unknown tool '{block.name}'"
                else:
                    try:
                        result, error = tool.handler(**block.input), None
                    except Exception as exc:  # tool handlers are user-supplied; surface failures to Claude
                        result, error = None, str(exc)

                tool_calls.append(
                    ToolCallRecord(name=block.name, arguments=dict(block.input), result=result, error=error)
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result if error is None else {"error": error}, default=str),
                        "is_error": error is not None,
                    }
                )

            messages.append({"role": "user", "content": tool_results})
        else:
            note = "(stopped after reaching the tool-call limit for this turn)"
            response_text = f"{response_text}\n{note}".strip() if response_text else note

        context.history.append(Message(role="user", content=user_message))
        context.history.append(Message(role="assistant", content=response_text))

        return BrainReply(response_text=response_text, tool_calls=tool_calls)
