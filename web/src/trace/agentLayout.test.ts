import { describe, it, expect } from "vitest";
import { agentMapToFlow } from "./agentLayout";
import { ROOT_AGENT_ID } from "./agentMap";

describe("agentMapToFlow", () => {
  it("lays out by depth (x) + sibling order (y) and marks running edges animated", () => {
    const { nodes, edges } = agentMapToFlow({
      agents: [
        {
          id: ROOT_AGENT_ID,
          name: "researcher",
          status: "ok",
          parentAgentId: null,
          depth: 0,
          toolCount: 1,
          tokens: 62,
        },
        {
          id: "sp1",
          name: "summarizer",
          status: "ok",
          parentAgentId: ROOT_AGENT_ID,
          depth: 1,
          toolCount: 0,
          tokens: 180,
        },
        {
          id: "sp2",
          name: "factcheck",
          status: "running",
          parentAgentId: ROOT_AGENT_ID,
          depth: 1,
          toolCount: 0,
          tokens: null,
        },
      ],
      edges: [
        { source: ROOT_AGENT_ID, target: "sp1" },
        { source: ROOT_AGENT_ID, target: "sp2" },
      ],
    });
    expect(nodes.find((n) => n.id === ROOT_AGENT_ID)!.position.x).toBe(0);
    expect(nodes.find((n) => n.id === "sp1")!.position.x).toBe(240);
    expect(nodes.find((n) => n.id === "sp1")!.position.y).toBe(0);
    expect(nodes.find((n) => n.id === "sp2")!.position.y).toBe(76);
    expect(nodes.find((n) => n.id === "sp2")!.data.isRoot).toBe(false);
    expect(nodes.find((n) => n.id === ROOT_AGENT_ID)!.data.isRoot).toBe(true);
    expect(edges.find((e) => e.target === "sp2")!.animated).toBe(true);
    expect(edges.find((e) => e.target === "sp1")!.animated).toBe(false);
  });
});
