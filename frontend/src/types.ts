// A single chat bubble. `user` and `assistant` are normal conversation
// turns; `tool_call` and `tool_result` are intermediate steps in an
// assistant turn. The chat renders compact cards for the tool steps
// and the LLM's tool invocations also open a dedicated panel for the
// tool — both happen in parallel.
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  name?: string;
  arguments?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  tool_call_id?: string;
}

// Whether the backend server is reachable, actively streaming, or offline
export type ConnectionStatus = "connected" | "responding" | "disconnected";
