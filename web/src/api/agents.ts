import type { AgentDetail } from "../types/AgentDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listAgents = () => fetch(scopedPath("/agents")).then(json<AgentDetail[]>);

export const getAgent = (id: string) => fetch(scopedPath(`/agents/${id}`)).then(json<AgentDetail>);

export const putAgent = (agent: AgentDetail, opts?: { create?: boolean }) =>
  fetch(scopedPath(`/agents/${agent.id}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent),
  }).then(json<AgentDetail>);

export const deleteAgent = (id: string) =>
  fetch(scopedPath(`/agents/${id}`), { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });
