import type { AgentInfo, AgentRetiredReason } from "./protocol.js";

export type AgentRegistration = {
  agentSessionId: string;
  wolframVersion: string;
  platform: string;
  seenAt: number;
};

export type AgentRegistryCallbacks = {
  onRetireAgents?: (agentSessionIds: string[], retiredAt: number) => void;
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentInfo>();

  constructor(private readonly callbacks: AgentRegistryCallbacks = {}) {}

  register(input: AgentRegistration): AgentInfo {
    const existing = this.agents.get(input.agentSessionId);
    if (existing?.retired && existing.retiredReason === "superseded") {
      return this.clone(existing);
    }

    const retiredAgents: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.agentSessionId === input.agentSessionId) continue;
      if (agent.retired) continue;

      this.agents.set(agent.agentSessionId, {
        ...agent,
        offline: true,
        retired: true,
        retiredReason: "superseded",
        offlineAt: input.seenAt,
      });
      retiredAgents.push(agent.agentSessionId);
    }

    const next: AgentInfo = {
      agentSessionId: input.agentSessionId,
      wolframVersion: input.wolframVersion,
      platform: input.platform,
      lastSeenAt: input.seenAt,
      offlineAt: undefined,
      offline: false,
      retired: false,
      retiredReason: undefined,
    };

    this.agents.set(input.agentSessionId, next);

    if (retiredAgents.length > 0) {
      this.callbacks.onRetireAgents?.(retiredAgents, input.seenAt);
    }

    return this.clone(next);
  }

  heartbeat(agentSessionId: string, seenAt: number): AgentInfo | undefined {
    const existing = this.agents.get(agentSessionId);
    if (!existing) return undefined;
    if (existing.retired) return undefined;

    const next: AgentInfo = {
      ...existing,
      lastSeenAt: seenAt,
      offlineAt: undefined,
      offline: false,
      retired: false,
      retiredReason: undefined,
    };

    this.agents.set(agentSessionId, next);
    return this.clone(next);
  }

  retire(agentSessionId: string, retiredAt: number, reason: AgentRetiredReason = "no_live_notebooks"): AgentInfo | undefined {
    const existing = this.agents.get(agentSessionId);
    if (!existing || existing.retired) return existing ? this.clone(existing) : undefined;

    const next: AgentInfo = {
      ...existing,
      offline: true,
      retired: true,
      retiredReason: reason,
      offlineAt: retiredAt,
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
        offline: true,
        offlineAt: now,
      });
      newlyOffline.push(agent.agentSessionId);
    }

    return newlyOffline;
  }

  private clone(agent: AgentInfo): AgentInfo {
    return { ...agent };
  }
}
