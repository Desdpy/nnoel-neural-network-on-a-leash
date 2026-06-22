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

## Plugins

Nnoel ships with a plugin system so features like a weather lookup, notebook, or web search can be added as self-contained modules. A plugin is **two co-located folders paired by `<id>`** — one inside the backend project, one inside the frontend project. Adding a plugin never requires editing the existing `backend/`, `frontend/src/`, or `config.toml`.

The reference implementation is the time plugin (`backend/plugins/time/` + `frontend/src/plugins/time/`) — the `get_local_time` tool, the autocomplete endpoint, the system-prompt rule + few-shot examples, and the Time panel UI all live in those two folders.

### Adding a new plugin

To add a feature called `weather`, create two folders (the `<id>` must match across both):

```
backend/plugins/weather/     # backend half
  __init__.py
  plugin.py                 # class WeatherPlugin(Plugin): ...
  tool.py                   # SCHEMA + run()
  # any other backend modules the tool needs

frontend/src/plugins/weather/  # frontend half (optional — only if you want a GUI)
  index.ts                  # default-export FrontendPlugin
  WeatherPanel.tsx
```

#### Backend side

Implements the `Plugin` Protocol defined in `backend/plugins/protocol.py`:

```python
# backend/plugins/weather/plugin.py
from fastapi import APIRouter
from .tool import SCHEMA, run

router = APIRouter()
# (optional) @router.get("/forecast") ...

class WeatherPlugin:
    id = "weather"
    tools = [{"schema": SCHEMA, "run": run}]
    router = router
    system_prompt = "3. For any weather question, call the get_weather tool."
    frontend = {
        "panel_component": "weatherPanel",
        "panel_spec": {"id": "weather", "component": "weatherPanel",
                       "title": "Weather", "floating": {"width": 400, "height": 360}},
        "taskbar": {"id": "weather", "label": "Weather", "icon": "cloud",
                    "action": "launchWeather", "toolName": "get_weather"},
    }

plugin = WeatherPlugin()
```

The backend registry (`backend/plugins/registry.py`) walks `backend/plugins/*/` at server startup, imports each `<id>/plugin.py` as `plugins.<id>.plugin`, and aggregates them into `TOOLS`, `HANDLERS`, `execute()`, `routers`, `system_prompt_fragments`, and `frontend_manifests`. A broken plugin is logged and skipped — the server still boots.

#### Frontend side (optional)

Exports a `FrontendPlugin` (type in `frontend/src/plugins/types.ts`):

```ts
// frontend/src/plugins/weather/index.ts
import type { FrontendPlugin } from "../types";
import { WeatherPanel } from "./WeatherPanel";

export default {
    id: "weather",
    toolName: "get_weather",
    panelComponentId: "weatherPanel",
    component: WeatherPanel,
    toolToPanel: { id: "weather", component: "weatherPanel", title: "Weather",
                   floating: { width: 400, height: 360 },
                   params: (args, result, extra) => ({ city: args.city, text: result }),
                   instanceTitle: (args) => `Weather in ${args.city}` },
    taskbar: { id: "weather", label: "Weather", icon: "cloud",
               action: "launchWeather", toolName: "get_weather" },
} satisfies FrontendPlugin;
```

The frontend registry (`frontend/src/plugins/registry.ts`) uses Vite's `import.meta.glob("./*/index.ts", { eager: true })` to pick up every plugin's `index.ts` at build time and produces `pluginComponents` (merged into Dockview's `components` prop), `pluginToolToPanel` (LLM-tool-name → `ToolPanelSpec`), and `pluginTaskbarEntries` (rendered by `TaskBar`).

Supported taskbar icons (by name): `clock`, `cloud`, `search`, `notebook`, `note`, `globe`. Add more by extending the `iconRegistry` in `frontend/src/components/TaskBar.tsx`.

#### Variants

- **Backend-only plugin** (no GUI): drop just `backend/plugins/<id>/` and omit the frontend folder. The LLM gets the tool and system-prompt guidance; no panel, no taskbar shortcut.
- **Frontend-only plugin** (rare): drop just `frontend/src/plugins/<id>/` and omit the backend folder. The UI shows a panel/shortcut for a tool that... shouldn't exist without a backend, so this is uncommon.

#### Activate

Rebuild + restart. The backend registry picks up `backend/plugins/<id>/plugin.py` automatically; the frontend Vite glob picks up `frontend/src/plugins/<id>/index.ts` at the next build. The LLM can now call the new tool, the system prompt includes its guidance, the taskbar shows the new shortcut (if any), and the LLM-driven tool result opens the new panel.

### Discovery mechanism (summary)

- **Backend**: `backend/plugins/registry.py` walks `backend/plugins/*/plugin.py` at server startup, imports each as `plugins.<id>.plugin`, and aggregates.
- **Frontend**: `frontend/src/plugins/registry.ts` uses Vite's `import.meta.glob` to eagerly import every `frontend/src/plugins/*/index.ts` at build time.

### URL namespace

Custom plugin endpoints are mounted at `/plugins/<id>/...`. The time plugin's autocomplete endpoint, for example, is `GET /plugins/time/timezones/locations` (it was `GET /tools/timezones/locations` before the refactor). The generic `POST /tools/{name}` direct-invocation endpoint is unchanged.

### Docker

The Dockerfile copies the two project trees recursively, so plugins are baked into the image without any special handling:

- **Frontend stage** (`Dockerfile:9`): `COPY frontend/ .` picks up `frontend/src/plugins/<id>/` and Vite's `import.meta.glob` bundles every plugin's React component into the static dist.
- **Runtime stage** (`Dockerfile:25`): `COPY backend/ backend/` picks up `backend/plugins/<id>/` and the Python registry discovers them at server startup.

There are two compose files and the add-a-plugin flow differs between them. Pick the one that matches how you deploy.

#### `docker-compose.prod.yml` — builds the image locally from your checkout

This is the simplest path for self-hosting: you own the build, every plugin you add is included on the next build.

```bash
# 1. Add the plugin (two folders, same <id>).
mkdir -p backend/plugins/weather frontend/src/plugins/weather
# ... create plugin.py / tool.py on the backend side ...
# ... create index.ts / WeatherPanel.tsx on the frontend side ...

# 2. Build + start. The Dockerfile recursively copies the plugin folders
#    into the image; the registry discovers them at startup.
docker compose -f docker-compose.prod.yml up --build
```

Subsequent plugin changes: edit the files, then `docker compose -f docker-compose.prod.yml up --build` again.

#### `docker-compose.yml` — pulls the prebuilt image from `ghcr.io`

This compose file uses `image: ghcr.io/desdpy/nnoel-neural-network-on-a-leash:latest` and does **not** build locally. Plugins you add to your working tree are **not** in the pulled image. To get a new plugin into a running `docker-compose.yml` deployment you must publish a new image first:

```bash
# 1. Add the plugin folders (same as above).
# 2. Commit + push to main. The GitHub Actions workflow
#    (.github/workflows/docker.yml) builds a fresh image and pushes
#    it to ghcr.io/desdpy/nnoel-neural-network-on-a-leash:latest.
git add backend/plugins/weather frontend/src/plugins/weather
git commit -m "Add weather plugin"
git push origin main

# 3. Pull the new image and recreate the container.
docker compose pull && docker compose up -d
```

If you don't want to wait for CI (or you're hacking on a plugin), build locally and override the image tag:

```bash
docker compose -f docker-compose.prod.yml build      # local build
docker compose -f docker-compose.yml up --build     # uses the local build via the prod Dockerfile
```

#### Verifying a plugin is live in the container

```bash
# The registry should list the new tool.
docker compose exec nnoel python -c "import plugins; print(plugins.TOOLS)"

# The /config endpoint should mention the new plugin's panel.
curl -s http://localhost:5000/config | python -m json.tool
```

If a plugin doesn't appear, check the backend log: `docker compose logs nnoel | grep -i plugin`. A broken plugin is logged and skipped (the container still boots) — look for `Plugin 'foo' failed to import; skipping`.

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
