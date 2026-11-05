import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Assertion, Step } from "./types.js";

export type PlaybookInput = {
  site: string;
  goal: string;
  url: string;
  steps: Step[];
  asserts?: Assertion[];
  remoteSlug?: string;
};

export type Playbook = PlaybookInput & {
  id: string;
  createdAt: string;
  verifiedAt: string;
  successCount: number;
  lastError?: string;
};

export type PlaybookMatch = { playbook: Playbook; score: number };

const normalizeSite = (site: string) => site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));

export class PlaybookStore {
  constructor(readonly dir = process.env.QUARRY_PLAYBOOKS ?? join(homedir(), ".cache", "quarry", "playbooks")) {}

  static idFor(input: PlaybookInput): string {
    const body = JSON.stringify({ site: normalizeSite(input.site), goal: input.goal.trim(), url: input.url, steps: input.steps, asserts: input.asserts ?? [] });
    return createHash("sha256").update(body).digest("hex").slice(0, 16);
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async save(input: PlaybookInput): Promise<Playbook> {
    if (!input.site.trim() || !input.goal.trim() || !input.url.trim() || input.steps.length === 0) {
      throw new Error("site, goal, url and at least one step are required");
    }
    await mkdir(this.dir, { recursive: true });
    const id = PlaybookStore.idFor(input);
    const existing = await this.load(id);
    const now = new Date().toISOString();
    const playbook: Playbook = {
      ...input,
      id,
      site: normalizeSite(input.site),
      createdAt: existing?.createdAt ?? now,
      verifiedAt: existing?.verifiedAt ?? now,
      successCount: existing?.successCount ?? 0,
      remoteSlug: input.remoteSlug ?? existing?.remoteSlug,
    };
    await writeFile(this.file(id), `${JSON.stringify(playbook, null, 2)}\n`, "utf8");
    return playbook;
  }

  async load(id: string): Promise<Playbook | null> {
    try {
      const raw = await readFile(this.file(id.replace(/[^a-f0-9]/gi, "")), "utf8");
      return JSON.parse(raw) as Playbook;
    } catch {
      return null;
    }
  }

  async list(): Promise<Playbook[]> {
    try {
      const entries = await readdir(this.dir);
      const loaded = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.load(entry.slice(0, -5))));
      return loaded.filter((item): item is Playbook => item !== null);
    } catch {
      return [];
    }
  }

  async find(site: string, goal: string, limit = 3): Promise<PlaybookMatch[]> {
    const all = await this.list();
    const wanted = normalizeSite(site);
    const scoped = all.filter((item) => normalizeSite(item.site) === wanted);
    const pool = scoped.length > 0 ? scoped : all;
    const query = words(`${goal} ${site}`);
    const ranked = pool.map((playbook) => {
      const document = words(`${playbook.goal} ${playbook.site} ${playbook.url}`);
      let hits = 0;
      for (const word of query) if (document.has(word)) hits += 1;
      const siteBoost = normalizeSite(playbook.site) === wanted ? 0.5 : 0;
      return { playbook, score: Number((hits / Math.max(query.size, 1) + siteBoost).toFixed(3)) };
    });
    return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async markResult(id: string, ok: boolean, error?: string): Promise<Playbook | null> {
    const playbook = await this.load(id);
    if (!playbook) return null;
    const now = new Date().toISOString();
    const next: Playbook = {
      ...playbook,
      successCount: playbook.successCount + (ok ? 1 : 0),
      verifiedAt: ok ? now : playbook.verifiedAt,
      lastError: ok ? undefined : error?.slice(0, 500),
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(playbook.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }
}
