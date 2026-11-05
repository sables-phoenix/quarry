import type { Playbook, PlaybookStore } from "./playbook.js";

export type LivingBrainConfig = {
  apiKey: string;
  subjectId: string;
  brainId: string;
  baseUrl: string;
};

export type LivingBrainSource = { id: string; status: string; label?: string; lastError?: string };
export type LivingBrainSearchResult = { slug: string; title: string; summary: string; status: string; similarity: number; matchedOn: string };
export type LivingBrainPage = { slug: string; title: string; body: string; status: string; version?: number };

export function livingBrainConfig(env: NodeJS.ProcessEnv = process.env): LivingBrainConfig | null {
  const apiKey = env.LIVING_BRAIN_API_KEY?.trim();
  const subjectId = env.LIVING_BRAIN_SUBJECT_ID?.trim();
  const brainId = env.LIVING_BRAIN_BRAIN_ID?.trim();
  if (!apiKey || !subjectId || !brainId) return null;
  return { apiKey, subjectId, brainId, baseUrl: (env.LIVING_BRAIN_BASE_URL ?? "https://api.livingbrain.com/v1").replace(/\/$/, "") };
}

export class LivingBrainError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export class LivingBrain {
  constructor(readonly config: LivingBrainConfig) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.config.apiKey,
        "x-subject-id": this.config.subjectId,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const inner = typeof record.body === "object" && record.body !== null ? (record.body as Record<string, unknown>) : {};
      throw new LivingBrainError(String(record.message ?? inner.message ?? `living brain ${response.status}`), response.status, String(inner.code ?? ""));
    }
    return body;
  }

  async captureContent(content: string, label: string, originRef: string): Promise<LivingBrainSource> {
    const body = await this.request(`/brains/${this.config.brainId}/captures`, {
      method: "POST",
      body: JSON.stringify({ kind: "note", content, label: label.slice(0, 256), originRef: originRef.slice(0, 512), bucket: "projects" }),
    });
    return body as LivingBrainSource;
  }

  async capture(playbook: Playbook): Promise<LivingBrainSource> {
    const content = [
      `# ${playbook.site} ${playbook.goal}`,
      "",
      `Site: ${playbook.site}`,
      `Goal: ${playbook.goal}`,
      `URL: ${playbook.url}`,
      `Verified: ${playbook.verifiedAt}`,
      `Success count: ${playbook.successCount}`,
      "",
      `quarry-playbook-id: ${playbook.id}`,
      "",
      "The executable steps and assertions stay in quarry's local playbook store. This page is the shared index entry.",
    ].join("\n");
    return this.captureContent(content, `${playbook.site} ${playbook.goal}`, `quarry:playbook:${playbook.id}`);
  }

  async search(site: string, goal: string, topK = 5): Promise<LivingBrainSearchResult[]> {
    const body = await this.request(`/brains/${this.config.brainId}/search`, {
      method: "POST",
      body: JSON.stringify({ query: `${site} ${goal}`.trim(), topK }),
    });
    return (body as LivingBrainSearchResult[]) ?? [];
  }

  async getPage(slug: string): Promise<LivingBrainPage> {
    return (await this.request(`/brains/${this.config.brainId}/pages/${encodeURIComponent(slug)}`)) as LivingBrainPage;
  }

  async listSources(): Promise<LivingBrainSource[]> {
    const body = (await this.request(`/brains/${this.config.brainId}/sources?limit=100`)) as { items?: LivingBrainSource[] };
    return body.items ?? [];
  }

  async find(site: string, goal: string, store: PlaybookStore): Promise<{ playbook: Playbook; slug: string } | null> {
    const results = await this.search(site, goal, 5);
    for (const result of results) {
      if (!["active", "contested"].includes(result.status)) continue;
      const page = await this.getPage(result.slug);
      const id = String(page.body ?? "").match(/quarry-playbook-id:\s*([a-f0-9]{16})/i)?.[1];
      if (!id) continue;
      const playbook = await store.load(id);
      if (playbook) return { playbook, slug: result.slug };
    }
    return null;
  }
}
