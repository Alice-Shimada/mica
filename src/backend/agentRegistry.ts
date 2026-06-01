import type { AgentInfo, AgentRetiredReason } from "./protocol.js";

export type AgentRegistration = {
  agentSessionId: string;
  wolframVersion: string;
  platform: string;
  seenAt: number;
  machineId?: string;
  frontendSessionId?: string;
  wolframProcessId?: string;
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentInfo>();

  register(input: AgentRegistration): AgentInfo {
    const next: AgentInfo = {
      agentSessionId: input.agentSessionId,
      wolframVersion: input.wolframVersion,
      platform: input.platform,
      lastSeenAt: input.seenAt,
      degradedAt: undefined,
      degraded: false,
      offlineAt: undefined,
      offline: false,
      retired: false,
      retiredReason: undefined,
      status: "live",
      machineId: input.machineId,
      frontendSessionId: input.frontendSessionId,
      wolframProcessId: input.wolframProcessId,
    };

    this.agents.set(input.agentSessionId, next);

    return this.clone(next);
  }

  heartbeat(agentSessionId: string, seenAt: number): AgentInfo | undefined {
    const existing = this.agents.get(agentSessionId);
    if (!existing) return undefined;
    if (existing.retired) return undefined;

    const next: AgentInfo = {
      ...existing,
      lastSeenAt: seenAt,
      degradedAt: undefined,
      degraded: false,
      offlineAt: undefined,
      offline: false,
      retired: false,
      retiredReason: undefined,
      status: "live",
    };

    this.agents.set(agentSessionId, next);
    return this.clone(next);
  }

  retire(agentSessionId: string, retiredAt: number, reason: AgentRetiredReason = "no_live_notebooks"): AgentInfo | undefined {
    const existing = this.agents.get(agentSessionId);
    if (!existing || existing.retired) return existing ? this.clone(existing) : undefined;

    const next: AgentInfo = {
      ...existing,
      degraded: false,
      degradedAt: undefined,
      offline: true,
      retired: true,
      retiredReason: reason,
      offlineAt: retiredAt,
      status: "retired",
    };

    this.agents.set(agentSessionId, next);
    return this.clone(next);
  }

  get(agentSessionId: string): AgentInfo | undefined {
    const existing = this.agents.get(agentSessionId);
    return existing ? this.clone(existing) : undefined;
  }

  list(): AgentInfo[] {
    return [...this.agents.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((agent) => this.clone(agent));
  }

  hasLiveAgent(): boolean {
    for (const agent of this.agents.values()) {
      if (!agent.offline && !agent.retired) return true;
    }

    return false;
  }

  markOfflineOlderThan(now: number, maxAgeMs: number): string[] {
    const newlyOffline: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.offline || agent.retired) continue;
      if (now - agent.lastSeenAt < maxAgeMs) continue;

      this.agents.set(agent.agentSessionId, {
        ...agent,
        degraded: false,
        degradedAt: undefined,
        offline: true,
        offlineAt: now,
        status: "offline",
      });
      newlyOffline.push(agent.agentSessionId);
    }

    return newlyOffline;
  }

  markDegradedOlderThan(now: number, maxAgeMs: number): string[] {
    const newlyDegraded: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.degraded || agent.offline || agent.retired) continue;
      if (now - agent.lastSeenAt < maxAgeMs) continue;

      this.agents.set(agent.agentSessionId, {
        ...agent,
        degraded: true,
        degradedAt: now,
        status: "degraded",
      });
      newlyDegraded.push(agent.agentSessionId);
    }

    return newlyDegraded;
  }

  private clone(agent: AgentInfo): AgentInfo {
    return { ...agent };
  }
}
