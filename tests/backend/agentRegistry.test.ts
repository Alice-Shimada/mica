import { describe, expect, it } from "vitest";
import { AgentRegistry } from "../../src/backend/agentRegistry.js";

describe("AgentRegistry", () => {
  it("registers and heartbeats agents", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.heartbeat("agent-1", 2000);

    expect(registry.get("agent-1")).toMatchObject({ agentSessionId: "agent-1", lastSeenAt: 2000, offline: false });
    expect(registry.hasLiveAgent()).toBe(true);
  });

  it("marks agents offline after the stale cutoff", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const offline = registry.markOfflineOlderThan(11_000, 10_000);

    expect(offline).toEqual(["agent-1"]);
    expect(registry.get("agent-1")?.offline).toBe(true);
    expect(registry.get("agent-1")?.lastSeenAt).toBe(1000);
    expect(registry.get("agent-1")?.offlineAt).toBe(11_000);
    expect(registry.hasLiveAgent()).toBe(false);
  });

  it("does not mark agents offline just before the cutoff", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });

    expect(registry.markOfflineOlderThan(10_999, 10_000)).toEqual([]);
    expect(registry.get("agent-1")?.offline).toBe(false);
    expect(registry.get("agent-1")?.lastSeenAt).toBe(1000);
  });

  it("does not re-report already offline agents on repeated cutoff checks", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });

    expect(registry.markOfflineOlderThan(11_000, 10_000)).toEqual(["agent-1"]);
    expect(registry.get("agent-1")?.offlineAt).toBe(11_000);
    expect(registry.markOfflineOlderThan(12_000, 10_000)).toEqual([]);
    expect(registry.get("agent-1")?.offlineAt).toBe(11_000);
  });

  it("returns undefined for unknown heartbeat agents", () => {
    const registry = new AgentRegistry();

    expect(registry.heartbeat("missing", 2000)).toBeUndefined();
  });

  it("lists newest agents first and avoids leaking mutable records", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Linux", seenAt: 3000 });

    const listed = registry.list();
    listed[0]!.offline = true;

    expect(listed.map((agent) => agent.agentSessionId)).toEqual(["agent-2", "agent-1"]);
    expect(registry.get("agent-2")?.offline).toBe(false);
  });

  it("marks older live agents offline when a new session registers", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Linux", seenAt: 3000 });

    expect(registry.get("agent-1")?.offline).toBe(true);
    expect(registry.get("agent-1")?.offlineAt).toBe(3000);
    expect(registry.get("agent-2")?.offline).toBe(false);
  });

  it("does not revive a superseded agent through explicit re-registration", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Linux", seenAt: 2000 });

    registry.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 3000 });

    expect(registry.get("agent-old")?.offline).toBe(true);
    expect(registry.get("agent-old")?.lastSeenAt).toBe(1000);
    expect(registry.get("agent-old")?.retiredReason).toBe("superseded");
    expect(registry.get("agent-new")?.offline).toBe(false);
    expect(registry.get("agent-new")?.retired).toBe(false);
  });

  it("records when an agent is retired because it has no live notebooks", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });

    registry.retire("agent-1", 2000, "no_live_notebooks");

    expect(registry.get("agent-1")?.retired).toBe(true);
    expect(registry.get("agent-1")?.retiredReason).toBe("no_live_notebooks");
  });

  it("preserves the existing reason when another registration sees an already retired agent", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-empty", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.retire("agent-empty", 2000, "no_live_notebooks");

    registry.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 3000 });

    expect(registry.get("agent-empty")?.retired).toBe(true);
    expect(registry.get("agent-empty")?.retiredReason).toBe("no_live_notebooks");
  });

  it("does not revive a retired agent via heartbeat", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Linux", seenAt: 2000 });

    expect(registry.heartbeat("agent-old", 3000)).toBeUndefined();
    expect(registry.get("agent-old")?.offline).toBe(true);
    expect(registry.get("agent-old")?.offlineAt).toBe(2000);
  });

  it("retires offline agents too when a new session registers", () => {
    const registry = new AgentRegistry();
    registry.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    registry.markOfflineOlderThan(5000, 1000);

    registry.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Linux", seenAt: 6000 });

    expect(registry.heartbeat("agent-old", 7000)).toBeUndefined();
    expect(registry.get("agent-old")?.retired).toBe(true);
    expect(registry.get("agent-old")?.offline).toBe(true);
  });
});
