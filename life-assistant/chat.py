"""Text-chat proof of concept: exercise the negotiation logic end-to-end
(brain -> tools -> scheduling engine) before adding voice.

Usage:
    ANTHROPIC_API_KEY=... python chat.py [--db canvas.db] [--model claude-opus-5]
"""

from __future__ import annotations

import argparse

from brain import SYSTEM_PROMPT, BrainContext, ClaudeBrain, build_scheduler_tools
from scheduler import Canvas, SchedulingEngine


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="canvas.db", help="Path to the canvas SQLite database.")
    parser.add_argument("--model", default=None, help="Override the Claude model (default: claude-opus-5).")
    args = parser.parse_args()

    engine = SchedulingEngine(Canvas(args.db))
    tools = build_scheduler_tools(engine)
    brain = ClaudeBrain(model=args.model) if args.model else ClaudeBrain()
    context = BrainContext(system_prompt=SYSTEM_PROMPT)

    print("Life assistant chat. Type 'exit' to quit.\n")
    while True:
        try:
            user_message = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not user_message:
            continue
        if user_message.lower() in ("exit", "quit"):
            break

        reply = brain.ask(user_message, tools, context)

        for call in reply.tool_calls:
            outcome = f"error: {call.error}" if call.error else f"-> {call.result}"
            print(f"  [tool] {call.name}({call.arguments}) {outcome}")

        print(f"Assistant: {reply.response_text}\n")


if __name__ == "__main__":
    main()
