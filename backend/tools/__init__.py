from typing import Any

from . import time

# Registry of tool definitions in OpenAI-compatible function-calling format
# Each entry describes one tool the LLM may ask to call
TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": time.SCHEMA},
]

# Maps tool name → callable that executes the tool
HANDLERS: dict[str, Any] = {
    time.SCHEMA["name"]: time.run,
}


def execute(name: str, arguments: dict[str, Any]) -> Any:
    """Dispatch a tool call by name, passing the provided arguments as kwargs.

    Tools are free to return either a plain string (used directly as the
    LLM-visible tool result) or a structured dict with a ``text`` field
    plus extra metadata the UI can consume.
    """
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}"
    return handler(**arguments)
