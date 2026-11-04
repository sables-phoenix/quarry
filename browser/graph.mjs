import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const MAX_STATES = 1000;

export function defaultGraphPath() {
  if (process.env.QUARRY_BROWSER_GRAPH) return process.env.QUARRY_BROWSER_GRAPH;
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "quarry", "browser-graph.json");
}

export function actionKey(steps) {
  return createHash("sha1").update(JSON.stringify(steps)).digest("hex").slice(0, 12);
}

export class Graph {
  constructor(path = defaultGraphPath()) {
    this.path = path;
    this.data = { states: {}, edges: {} };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw && raw.states && raw.edges) this.data = raw;
    } catch {}
  }

  rememberState(state) {
    this.data.states[state.hash] = { url: state.url, text: state.text.slice(0, 2000) };
    const keys = Object.keys(this.data.states);
    if (keys.length > MAX_STATES) for (const key of keys.slice(0, keys.length - MAX_STATES)) delete this.data.states[key];
  }

  record(from, steps, to) {
    const key = `${from}|${actionKey(steps)}`;
    this.data.edges[key] = { from, to, steps };
    this.save();
  }

  neighbors(hash) {
    return Object.values(this.data.edges).filter((e) => e.from === hash);
  }

  path(from, to, limit = 12) {
    if (from === to) return [];
    const queue = [[from, []]];
    const seen = new Set([from]);
    while (queue.length) {
      const [node, path] = queue.shift();
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

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data));
  }
}
