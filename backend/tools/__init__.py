from typing import Any

from . import time_server

# Registry of tool definitions in OpenAI-compatible function-calling format
# Each entry describes one tool the LLM may ask to call
TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": time_server.SCHEMA},
]

# Maps tool name → callable that executes the tool
HANDLERS: dict[str, Any] = {
    time_server.SCHEMA["name"]: time_server.run,
}


def execute(name: str, arguments: dict[str, Any]) -> str:
    """Dispatch a tool call by name, passing the provided arguments as kwargs."""
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}"
    return handler(**arguments)
