from typing import Any

from . import time_server

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": time_server.SCHEMA},
]

HANDLERS: dict[str, Any] = {
    time_server.SCHEMA["name"]: time_server.run,
}


def execute(name: str, arguments: dict[str, Any]) -> str:
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}"
    return handler(**arguments)
