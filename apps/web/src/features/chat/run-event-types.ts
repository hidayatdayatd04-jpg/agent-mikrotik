import type { Dispatch, SetStateAction } from "react";
import type { RunEventDTO } from "./chat-hooks";

export interface LiveToolItem {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
}

export const TERMINAL = ["completed", "failed", "cancelled"];

export const STREAM_EVENT_TYPES = [
  "run.started",
  "message.delta",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "transaction.updated",
  "provider.waiting",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;

export interface RunEventsSink {
  setEvents: Dispatch<SetStateAction<RunEventDTO[]>>;
  setStreamText: Dispatch<SetStateAction<string>>;
  setToolActivity: Dispatch<SetStateAction<LiveToolItem[]>>;
  setTxStatus: Dispatch<SetStateAction<string | null>>;
  setQueueStatus: Dispatch<SetStateAction<string | null>>;
  setLive: Dispatch<SetStateAction<boolean>>;
}
