from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

# OpenAI-compatible function schema — describes the tool to the LLM so it
# knows when and how to call it (name, description, parameter spec)
SCHEMA: dict[str, Any] = {
    "name": "get_local_time",
    "description": "Get the current local time. Optionally specify a IANA timezone (e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo').",
    "parameters": {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone name (e.g. 'America/New_York'). Defaults to local system time.",
                "default": "local",
            },
        },
        "additionalProperties": False,
    },
}


def run(timezone: str = "local") -> str:
    """Execute the get_local_time tool: return the current time, optionally in a given timezone."""
    if timezone == "local":
        now = datetime.now()
        return now.strftime("%Y-%m-%d %H:%M:%S")
    try:
        tz = ZoneInfo(timezone)
        now = datetime.now(tz)
        return now.strftime("%Y-%m-%d %H:%M:%S %Z")
    except Exception as e:
        return f"Invalid timezone '{timezone}': {e}"
