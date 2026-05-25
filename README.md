# Nnoel - Neural network on a leash
A helper where every action taken by the AI is tightly controlled by permissions. Everything that happens in the background will be seen by the user.

![MEME](Nnoel.jpg)

## Goals:
- Similar goal as OpenClaw but less hands-off and more controlled active co-sessions with user. Doesn't take over full tasks but helps getting through them quicker
- Helping with e-mails, messages, appointments etc.
- Every single step executed by the AI will be visible on the UI
- Local first
- Make it well usable with smaller models (~9B) with less powerful PCs (<12Gb VRAM)
- Full static (not with prompting) permission system separate of LLM for all steps/commands/interactions with outside systems 
- Retry current message/command (conversation branches)
- Being able to manually edit suggested commands/step by the LLM
- Less functions will go through the LLM and will be separately and statically implemented
- Every function like e-mail, appointment etc. management will be provided in enableable/disableable modules enabling easier implementation of custom plugins
- RAG for longterm memory
- STT & TTS first, an assistant that you can speak with
- instead of connecting it to other messenger apps this will have a separate web ui to make everything graphically possible

## References
- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)