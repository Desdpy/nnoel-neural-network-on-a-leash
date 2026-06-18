from datetime import datetime
from typing import Any

from zoneinfo import ZoneInfo

from .timezones import resolve as _resolve_location

# OpenAI-compatible function schema — describes the tool to the LLM.
# The model passes a single human-readable ``location`` string (country,
# continent, city, or alias) and the backend resolves it to an IANA
# timezone via :mod:`tools.timezones`. This keeps the schema tiny (no
# 600-value enum) while still letting the model express any location
# the user might ask about.
SCHEMA: dict[str, Any] = {
    "name": "get_local_time",
    "description": (
        "Get the current time. Pass a country (e.g. 'Japan', 'France'), "
        "continent (e.g. 'Asia', 'Europe'), or major city (e.g. 'Tokyo', "
        "'Paris', 'New York'). Common short-form names like 'USA' or 'UK' "
        "also work. OMIT the location argument (call with no arguments) "
        "when the user asks about their own time, 'the time here', "
        "'local time', or 'what time is it?' without mentioning a place — "
        "the tool will then return the host's system clock."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": (
                    "A country, continent, or city name. The backend "
                    "resolves it to the appropriate IANA timezone. "
                    "OMIT this argument entirely (do not pass 'local' or "
                    "anything else) when the user asks about their own "
                    "time, 'the time here', 'local time', or 'current time' "
                    "without naming a place."
                ),
                "default": "local",
            },
        },
        "additionalProperties": False,
    },
}


def run(location: str = "local") -> str:
    """Execute the get_local_time tool: return the current time for the given location."""
    try:
        tz_name = _resolve_location(location)
    except ValueError as e:
        return str(e)

    if tz_name == "local":
        now = datetime.now()
        return now.strftime("%Y-%m-%d %H:%M:%S")
    try:
        tz = ZoneInfo(tz_name)
        now = datetime.now(tz)
        return now.strftime("%Y-%m-%d %H:%M:%S %Z")
    except Exception as e:
        return f"Resolved to '{tz_name}' but the IANA database rejected it: {e}"
