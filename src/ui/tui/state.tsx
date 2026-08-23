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
  /** Live session cache hit ratio; null when no cache data. */
  cacheHitRatio: number | null;
  currentSession: string;
  isLoading: boolean;
  permissionMode: PermissionMode;
  pendingPrompt: (Prompt & { resolve: (value: string) => void }) | null;
  showReceipt: boolean;
  /** Messages queued for injection while the agent is running. */
  steeringQueue: string[];
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
  cacheHitRatio: null,
  currentSession: "",
  isLoading: false,
  permissionMode: "manual",
  pendingPrompt: null,
  showReceipt: false,
  steeringQueue: [],
};

export const useTuiState = create<TuiState>(() => ({
  ...initialState,
}));
