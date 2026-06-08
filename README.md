# Nnoel - Neural network on a leash
A local-first AI assistant that works on CPU only systems, whose every action is tightly controlled and audited by you. Everything the AI does in the background will be visualized in the web UI.

![MEME](Nnoel.jpg)

## Goals:
- Similar goal as OpenClaw but less hands-off and more controlled active co-sessions with user. Doesn't take over full tasks but helps getting through them quicker
- Helping with e-mails, messages, appointments etc.
- Every single step executed by the AI will be visible on the UI
- Local first
- **CPU first,** make it well usable with smaller models (<2B) on less powerful PCs/servers that don't have a GPU
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
- **Be a coding agent** - I doubt that it is possible to do this with <2b LLM models and there is already the project [SmallCode](https://github.com/Doorman11991/smallcode) out there which works with small models (>8b)
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
- Python
- llama-cpp-python
- FastAPI

## Setup

### 1. Configure

Requirements:
```bash
sudo zypper install gcc-c++ cmake
```

Edit `backend/config.toml` to point to your llama.cpp server:

```toml
[llama]
url = "http://localhost:8080"

[server]
host = "127.0.0.1"
port = 5000
```

### 2. Install backend

```bash
cd backend && python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Install frontend

```bash
cd frontend && npm install
```

### 6. Build frontend

```bash
cd frontend && npm run build
```

### 7. Start

```bash
cd backend && python server.py
```
or
```bash
./start.sh
```

```bash
docker compose -f docker-compose.prod.yml up --build
```

Open the web UI at `http://{host}:{port}` (see `config.toml`).

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
