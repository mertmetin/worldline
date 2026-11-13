import type { SaveFile, TurnNode } from "../server/timeline";

export type { SaveFile, TurnNode };
export type TimelineResponse = SaveFile & { mode: "ai" | "offline" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export const api = {
  timeline: () => call<TimelineResponse>("/api/timeline"),
  turn: (parentId: string, action: string) =>
    call<TurnNode>("/api/turn", { method: "POST", body: JSON.stringify({ parentId, action }) }),
  reset: () => call<SaveFile>("/api/reset", { method: "POST" }),
};
