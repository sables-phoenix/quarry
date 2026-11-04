import { createHash } from "node:crypto";

import type { AxNode, State, StateNode, Delta, Projection } from "./types.js";
export type { AxNode, State, StateNode, Delta, Projection };

const KEEP = new Set([
  "heading", "paragraph", "button", "link", "textbox", "checkbox", "radio",
  "combobox", "switch", "tab", "alert", "dialog", "status", "searchbox",
]);

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function buildState(nodes: AxNode[], url: string, options: { scope?: string; maxName?: number } = {}): State {
  const scope = options.scope ?? "auto";
  const maxName = options.maxName ?? 180;
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const chain = (n: AxNode): string[] => {
    const out: string[] = [];
    let cur: AxNode | undefined = n;
    while (cur?.parentId) {
      out.push(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return out;
  };
  let rootId: string | null = null;
  if (scope === "auto") {
    const landmark = nodes.find((n) => ["main", "form", "dialog"].includes(n.role?.value ?? "") && !n.ignored);
    rootId = landmark?.nodeId ?? null;
  }
  const inScope = (n: AxNode): boolean => !rootId || n.nodeId === rootId || chain(n).includes(rootId);
  const liveAncestor = (n: AxNode): AxNode | null => {
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    for (let i = 0; cur && i < 6; i++) {
      const live = (cur.properties ?? []).find((p) => p.name === "live");
      if (live && live.value?.value !== "off") return cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };
  const seen = new Map<string, number>();
  const out: StateNode[] = [];
  for (const n of nodes) {
    if (n.ignored || !inScope(n)) continue;
    const role = n.role?.value ?? "";
    let name = (n.name?.value ?? "").replace(/\s+/g, " ").trim();
    const value = (n.value?.value ?? "").replace(/\s+/g, " ").trim();
    if (role === "StaticText") {
      const live = liveAncestor(n);
      if (!live) continue;
      const parentName = (live.name?.value || (live.parentId ? byId.get(live.parentId)?.name?.value : "") || "live").slice(0, 40);
      const key = `live|${parentName}`;
      const ord = seen.get(key) ?? 0;
      seen.set(key, ord + 1);
      out.push({ id: hash(`${key}#${ord}`), role: "live", name: parentName, value: name.slice(0, 60) });
      continue;
    }
    if (!KEEP.has(role) || (!name && !value)) continue;
    if (role === "paragraph" && name.length < 60) continue;
    if (!name) name = value;
    const key = `${role}|${name.slice(0, 80)}`;
    const ord = seen.get(key) ?? 0;
    seen.set(key, ord + 1);
    out.push({ id: hash(`${key}#${ord}`), role, name: name.slice(0, maxName), value });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  const text = out.map((n) => `${n.id} ${n.role} ${n.name}${n.value ? " = " + n.value : ""}`).join("\n");
  return {
    hash: hash(url.split("#")[0] + "\n" + text),
    url,
    nodes: out,
    text,
    chars: text.length,
    tokens: estimateTokens(text.length),
    map: new Map(out.map((n) => [n.id, n])),
  };
}

export function diffStates(a: State, b: State): Delta {
  const added: StateNode[] = [];
  const removed: StateNode[] = [];
  const changed: StateNode[] = [];
  for (const [id, n] of b.map) {
    if (!a.map.has(id)) added.push(n);
    else if (a.map.get(id)?.value !== n.value) changed.push(n);
  }
  for (const [id, n] of a.map) if (!b.map.has(id)) removed.push(n);
  const text = [
    ...group(removed, "-"),
    ...group(added, "+"),
    ...changed.map((n) => `~ ${n.role} ${n.name} = ${n.value}`),
  ].join("\n");
  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    text,
    chars: text.length,
    tokens: estimateTokens(text.length),
    empty: text.length === 0,
  };
}

function group(list: StateNode[], sign: string): string[] {
  if (list.length === 0) return [];
  if (list.length <= 5) return list.map((n) => `${sign} ${n.role} ${n.name}${n.value ? " = " + n.value : ""}`);
  const byRole = new Map<string, StateNode[]>();
  for (const n of list) byRole.set(n.role, [...(byRole.get(n.role) ?? []), n]);
  return [...byRole].map(([role, items]) =>
    `${sign} ${items.length} ${role} e.g. ${items.slice(0, 3).map((n) => n.name + (n.value ? " = " + n.value : "")).join(", ")}`
  );
}

export function projectState(state: State, query: string, options: { max?: number } = {}): Projection | null {
  const max = options.max ?? 4000;
  const terms = String(query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (terms.length === 0) return null;
  const hits = state.nodes.filter((n) => terms.some((t) => n.name.toLowerCase().includes(t)));
  if (hits.length === 0) return null;
  const chosen = hits.slice(0, max);
  const text = chosen.map((n) => `${n.id} ${n.role} ${n.name}${n.value ? " = " + n.value : ""}`).join("\n");
  return { nodes: chosen, text, chars: text.length, tokens: estimateTokens(text.length), matched: hits.length };
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}
