# Nnoel - Neural network on a leash
A local-first AI assistant that works on CPU only systems, whose every action is tightly controlled and audited by you. Everything the AI does in the background will be visualized in the web UI.

![MEME](Nnoel.jpg)

## Goals:
- Similar goal as OpenClaw but less hands-off and more controlled active co-sessions with user. Doesn't take over full tasks but helps getting through them quicker
- Helping with e-mails, messages, appointments etc.
- Every single step executed by the AI will be visible on the UI
- Local first
- **CPU first,** make it well usable with smaller models (~1B) on less powerful PCs/servers that don't have a GPU
- Full static (not with prompting) permission system separate of LLM for all steps/commands/interactions with outside systems 
- Retry current message/command (conversation branches)
- Being able to manually edit suggested commands/step by the LLM
- Less functions will go through the LLM and will be separately and statically implemented
- Every function like e-mail, appointment etc. management will be provided in enableable/disableable modules enabling easier implementation of custom plugins
- RAG for longterm memory
- STT & TTS first, an assistant that you can speak with
- instead of connecting it to other messenger apps this will have a separate web ui to make everything graphically possible

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
- FastAPI

## Setup

### 1. Configure

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

Open the web UI at `http://{host}:{port}` (see `config.toml`).

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
