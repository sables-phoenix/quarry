import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { Step, State } from "./types.js";

const MAX_STATES = 1000;

export function defaultGraphPath(): string {
  if (process.env.QUARRY_BROWSER_GRAPH) return process.env.QUARRY_BROWSER_GRAPH;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "quarry", "browser-graph.json");
}

export function actionKey(steps: Step[]): string {
  return createHash("sha1").update(JSON.stringify(steps)).digest("hex").slice(0, 12);
}

type Edge = { from: string; to: string; steps: Step[] };
type GraphData = { states: Record<string, { url: string; text: string }>; edges: Record<string, Edge> };

export class Graph {
  readonly file: string;
  private data: GraphData = { states: {}, edges: {} };

  constructor(path = defaultGraphPath()) {
    this.file = path;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as GraphData;
      if (raw?.states && raw?.edges) this.data = raw;
    } catch {}
  }

  rememberState(state: State): void {
    this.data.states[state.hash] = { url: state.url, text: state.text.slice(0, 2000) };
    const keys = Object.keys(this.data.states);
    if (keys.length > MAX_STATES) {
      for (const key of keys.slice(0, keys.length - MAX_STATES)) delete this.data.states[key];
    }
  }

  record(from: string, steps: Step[], to: string): void {
    this.data.edges[`${from}|${actionKey(steps)}`] = { from, to, steps };
    this.save();
  }

  neighbors(hash: string): Edge[] {
    return Object.values(this.data.edges).filter((edge) => edge.from === hash);
  }

  path(from: string, to: string, limit = 12): Step[][] | null {
    if (from === to) return [];
    const queue: Array<[string, Step[][]]> = [[from, []]];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const [node, path] = queue.shift()!;
      if (path.length >= limit) continue;
      for (const edge of this.neighbors(node)) {
        if (seen.has(edge.to)) continue;
        const next = [...path, edge.steps];
        if (edge.to === to) return next;
        seen.add(edge.to);
        queue.push([edge.to, next]);
      }
    }
    return null;
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
  }
}
