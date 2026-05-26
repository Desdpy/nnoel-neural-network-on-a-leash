export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type ConnectionStatus = "connected" | "responding" | "disconnected";
