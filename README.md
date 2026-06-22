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

```bash
clone, cd frontend && npm install, ./startProd.sh.
```

Open the web UI at `http://{host}:{port}` (see `config.toml`).

## Plugins

Nnoel ships with a plugin system so features like a weather lookup, notebook, or web search can be added as self-contained modules. A plugin is a single co-located folder under `plugins/<id>/` at the repo root, containing a `backend/` subpackage (the Python tool, custom endpoints, system-prompt guidance) and optionally a `frontend/` subfolder (the React panel + a default-exporting `index.ts` manifest). Adding a plugin never requires editing `backend/`, `frontend/src/`, or `config.toml`, and — with the prebuilt image — never requires rebuilding the image either: just drop the folder into `./plugins/` and `docker compose restart`.

The reference implementation is the time plugin at `plugins/time/` — the `get_local_time` tool, the autocomplete endpoint, the system-prompt rule + few-shot examples, and the Time panel UI all live in that one folder.

### Adding a new plugin

To add a feature called `weather`, create one co-located folder (the `<id>` must match the backend and frontend halves):

```
plugins/weather/
  backend/                # Python half (required for the tool)
    __init__.py
    plugin.py             # class WeatherPlugin(Plugin): ...
    tool.py               # SCHEMA + run()
  frontend/               # frontend half (optional — only if you want a GUI)
    index.ts              # default-export FrontendPlugin
    WeatherPanel.tsx
```

#### Backend half

Implements the `Plugin` Protocol defined in `backend/plugins/protocol.py`:

```python
# plugins/weather/backend/plugin.py
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

The backend registry (`backend/plugins/registry.py`) walks `plugins/<id>/backend/` at server startup, imports each as `nnoel_plugins.<id>.backend.plugin` (via a synthetic parent module), and aggregates them into `TOOLS`, `HANDLERS`, `execute()`, `routers`, `system_prompt_fragments`, and `frontend_manifests`. A broken plugin is logged and skipped — the server still boots.

The `backend/` subfolder of a plugin **must be a regular Python package** (have its own `__init__.py`) so the relative import `from .tool import …` works inside `plugin.py`.

#### Frontend half (optional)

Exports a `FrontendPlugin` (type in `frontend/src/plugins/types.ts`):

```ts
// plugins/weather/frontend/index.ts
import type { FrontendPlugin } from "../../types";
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

**Why `../../types`?** The frontend registry's Vite glob walks up to the repo root and resolves `plugins/*/frontend/index.ts` directly — no copy step is needed. The relative `../../types` resolves correctly from the plugin's source location (`plugins/<id>/frontend/`), and the `@` alias in `vite.config.ts` is an absolute path so `@/lib/logger`, `@/components/ui/...`, and `@/plugins/types` all resolve to files under `frontend/src/` regardless of where the plugin lives on disk.

The frontend registry (`frontend/src/plugins/registry.ts`) uses Vite's `import.meta.glob("../../../plugins/*/frontend/index.ts", { eager: true })` to pick up every plugin's `index.ts` at build time and produces `pluginComponents` (merged into Dockview's `components` prop), `pluginToolToPanel` (LLM-tool-name → `ToolPanelSpec`), and `pluginTaskbarEntries` (rendered by `TaskBar`).

Supported taskbar icons (by name): `clock`, `cloud`, `search`, `notebook`, `note`, `globe`. Add more by extending the `iconRegistry` in `frontend/src/components/TaskBar.tsx`.

#### Variants

- **Backend-only plugin** (no GUI): drop just `plugins/<id>/backend/` and omit the frontend half. The LLM gets the tool and system-prompt guidance; no panel, no taskbar shortcut.
- **Frontend-only plugin** (rare): drop just `plugins/<id>/frontend/` and omit the backend half. The UI shows a panel/shortcut for a tool that shouldn't exist without a backend, so this is uncommon.

#### Activate

**With the prebuilt image (`docker-compose.yml`)**: drop the folder, restart the container, refresh the browser. The entrypoint detects the mounted frontend plugins and rebuilds the bundle (~3 s when a frontend plugin is present, zero overhead otherwise), then the backend's Python registry picks up the backend half on import. **No `docker build` needed.**

```bash
mkdir -p plugins/weather/{backend,frontend}
# ... create the files ...
docker compose restart nnoel
# browser refresh → "Weather" in the sidebar
```

**With the from-source image (`docker-compose.prod.yml`)**: same as above, but you can also bake the plugin into the image by re-running `docker compose -f docker-compose.prod.yml up --build`.

**Local dev (no Docker)**: just build and run — the Vite glob picks plugins up directly from `plugins/`, no sync needed.

```bash
cd frontend && npm run build
cd .. && python3 backend/server.py
```

### Discovery mechanism (summary)

- **Backend**: `backend/plugins/registry.py` walks `plugins/<id>/backend/plugin.py` at server startup, imports each as `nnoel_plugins.<id>.backend.plugin` via a synthetic parent module, and aggregates.
- **Frontend**: `frontend/src/plugins/registry.ts` uses Vite's `import.meta.glob("../../../plugins/*/frontend/index.ts")` to pick up every plugin's `index.ts` at build time. The same glob works in dev, `startProd.sh`, and the container — in Docker the `./plugins:/app/plugins` volume mount makes the host's plugin dir visible at the path the glob expects.

### URL namespace

Custom plugin endpoints are mounted at `/plugins/<id>/...`. The time plugin's autocomplete endpoint is `GET /plugins/time/timezones/locations` (it was `GET /tools/timezones/locations` before the plugin system was introduced). The generic `POST /tools/{name}` direct-invocation endpoint is unchanged.

### Docker (the barebones runtime-rebuild image)

The prebuilt image is **barebones** — zero plugins baked in. It ships the Python backend, Node.js 22, the frontend source, and the Vite `node_modules` so the entrypoint can rebuild the bundle at container start. The user's `plugins/` is mounted as a single volume; the entrypoint normalises it and optionally rebuilds.

**No `docker build`, no `npm run build` on the host.** Just drop plugin folders and restart.

#### Install + first run (no clone needed)

```bash
mkdir nnoel && cd nnoel
curl -O https://raw.githubusercontent.com/desdpy/nnoel-neural-network-on-a-leash/main/docker-compose.yml
mkdir -p plugins      # empty = zero plugins; the image runs as a plain chatbot
docker compose up -d
# open http://localhost:5000
```

**First plugin (no clone, using the README template):** see "Activate" above — drop a `plugins/hello/{backend,frontend}/` pair, `docker compose restart nnoel`, refresh.

**First plugin (with the repo's reference):** clone the repo and `cp -r plugins/time plugins/time_yours` (or just leave `plugins/time/` as-is), then `docker compose restart nnoel` — the time plugin will be mounted and live.

#### Updating the image

```bash
docker compose pull && docker compose up -d
```

Your `plugins/` (host-mounted), `data/` (chat history), and `models` (named volume) all persist across image updates.

#### Verifying a plugin is live

```bash
docker compose exec nnoel python -c "import plugins; print(plugins.TOOLS)"
curl -s http://localhost:5000/config | python -m json.tool
docker compose logs nnoel | grep -i plugin   # look for "Loaded N plugin(s): ..."
```

A broken plugin is logged and skipped — the container still boots. Look for `Plugin 'foo' failed to import; skipping` in the logs.

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
