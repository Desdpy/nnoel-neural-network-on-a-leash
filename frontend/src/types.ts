// A single chat message — either from the user or from the AI assistant
export interface Message {
  role: "user" | "assistant";
  content: string;
}

// Whether the backend server is reachable, actively streaming, or offline
export type ConnectionStatus = "connected" | "responding" | "disconnected";
