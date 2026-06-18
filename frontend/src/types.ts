// A single chat bubble.  User and assistant are normal conversation turns;
// `tool_call` and `tool_result` are intermediate steps inside a single
// assistant turn, surfaced to the UI for transparency.
export interface Message {
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

// Whether the backend server is reachable, actively streaming, or offline
export type ConnectionStatus = "connected" | "responding" | "disconnected";
