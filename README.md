# Nnoel - Neural network on a leash
A local-first AI assistant that works on CPU only systems, whose every action is tightly controlled and audited by you. Everything the AI does in the background will be visualized in the web UI.

<div align="center">
  <img src="Nnoel.jpg" width="500" alt="MEME">
</div>

## Goals:
- Similar goal as OpenClaw but less hands-off and more controlled active co-sessions with user. Doesn't take over full tasks but helps getting through them quicker
- Helping with e-mails, messages, appointments etc.
- Every single step executed by the AI will be visible on the UI
- Local first
- **CPU first,** make it well usable with smaller models (2B) on less powerful PCs/servers that don't have a GPU
- Full static (not with prompting) permission system separate of LLM for all steps/commands/interactions with outside systems 
- Retry current message/command (conversation branches)
- Being able to manually edit suggested commands/step by the LLM
- Less functions will go through the LLM and will be separately and statically implemented
- Every function like e-mail, appointment etc. management will be provided in enableable/disableable modules enabling easier implementation of custom plugins
- RAG for longterm memory
- STT & TTS first, an assistant that you can speak with
- instead of connecting it to other messenger apps this will have a separate web ui to make everything graphically possible
- Uses MCP internally

## Features that are **NOT** in scope:
- **Be a coding agent** - I doubt that it is possible to do this with 2b LLM models and there is already a great coding agent out there called [SmallCode](https://github.com/Doorman11991/smallcode) which was build with small models (>8b) in mind
- **Create skills on her own** - The small LLM models are not smart enough to do this effectively and this would go against the idea of the project (overview over everything)
- **Adjust her behavior in any meaningful way on her own** - Same as above
- **Custom skills/plugins** - The small LLM models will be specifically finetuned to be able to do specified tasks in the program that work together with each other which makes it hard to add functions those models are not finetuned on, or the models have to be replaced with bigger ones or retrained for each specific plugin and replaced which is out of this scope

## Stack

### Frontend
- Typescript
- React
- Tailwind CSS
- Vite
- Dockview
- Shadcn UI

### Backend
- Python 3.11+
- llama-cpp-python
- FastAPI
- Parakeet
- Silero VAD
- Piper
- Gemma 4 E2B

## Setup

### 1. Configure

Requirements:
```bash
sudo zypper install gcc-c++ cmake
```

Edit `backend/config.toml` to configure the model and TTS:

```toml
[server]
host = "0.0.0.0"
port = 5000

[llama]
n_ctx = 32768
n_threads = 6
```

### 2. Install backend

```bash
cd backend && python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Install frontend

```bash
cd frontend && npm install
```

### 4. Build frontend

```bash
cd frontend && npm run build
```

### 5. Start

```bash
cd backend && python server.py
```
or
```bash
./startProd.sh
```

```bash
docker compose -f docker-compose.prod.yml up --build
```

Open the web UI at `http://{host}:{port}` (see `config.toml`).

## Adding tools

Nnoel can call external tools through the OpenAI-compatible function-calling interface. New tools are added as Python modules under `backend/tools/` and registered in the package's `__init__.py`.

### 1. Create a tool module

Each tool module must export two things:

- `SCHEMA` — a dict in OpenAI function-calling format describing the tool's name, description, and parameters.
- `run(**kwargs)` — a callable that executes the tool and returns a string result.

Use `backend/tools/time.py` as a template:

```python
from datetime import datetime
from typing import Any

SCHEMA: dict[str, Any] = {
    "name": "get_local_time",
    "description": "Get the current local time. Optionally specify a IANA timezone.",
    "parameters": {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone name (e.g. 'America/New_York').",
                "default": "local",
            },
        },
        "additionalProperties": False,
    },
}


def run(timezone: str = "local") -> str:
    if timezone == "local":
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ...
```

### 2. Register the tool

Import your new module and add it to both the `TOOLS` list and the `HANDLERS` dict in `backend/tools/__init__.py`:

```python
from . import time, my_new_tool

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": time.SCHEMA},
    {"type": "function", "function": my_new_tool.SCHEMA},
]

HANDLERS: dict[str, Any] = {
    time.SCHEMA["name"]: time.run,
    my_new_tool.SCHEMA["name"]: my_new_tool.run,
}
```

Restart the backend and the LLM will be able to call your tool automatically.

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
