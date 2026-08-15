import { create } from "zustand";
import type { DisplayMessage } from "../display.js";
import type { Prompt } from "../../core/prompt.js";
import type { AgentSession, PermissionMode } from "../../services/index.js";

export interface InputState {
  mode: string;
  value: string;
  props: Record<string, unknown>;
  key: number;
}

export interface TuiState {
  messages: DisplayMessage[];
  input: InputState;
  agentSessions: AgentSession[];
  activeAgentId: string;
  tokenCount: number;
  currentSession: string;
  isLoading: boolean;
  status: string;
  permissionMode: PermissionMode;
  pendingPrompt: (Prompt & { resolve: (value: string) => void }) | null;
  showReceipt: boolean;
}

export const initialState: TuiState = {
  messages: [],
  input: {
    mode: "chat",
    value: "",
    props: {},
    key: 0,
  },
  agentSessions: [],
  activeAgentId: "1",
  tokenCount: 0,
  currentSession: "",
  isLoading: false,
  status: "",
  permissionMode: "manual",
  pendingPrompt: null,
  showReceipt: false,
};

export const useTuiState = create<TuiState>(() => ({
  ...initialState,
}));
