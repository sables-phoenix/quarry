import { createHash } from "node:crypto";

const KEEP = new Set([
  "heading", "paragraph", "button", "link", "textbox", "checkbox", "radio",
  "combobox", "switch", "tab", "alert", "dialog", "status", "searchbox",
]);

const LIVE_ROLES = new Set(["status", "alert"]);

export function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

export function buildState(nodes, url, options = {}) {
  const scope = options.scope ?? "auto";
  const maxName = options.maxName ?? 180;
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const parentOf = new Map();
  for (const n of nodes) for (const c of n.childIds || []) parentOf.set(c, n.nodeId);
  const chain = (n) => {
    const out = [];
    let cur = n;
    while (cur && cur.parentId) {
      out.push(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return out;
  };
  let rootId = null;
  if (scope === "auto") {
    const landmark = nodes.find((n) => ["main", "form", "dialog"].includes(n.role?.value) && !n.ignored);
    rootId = landmark ? landmark.nodeId : null;
  }
  const inScope = (n) => !rootId || n.nodeId === rootId || chain(n).includes(rootId);
  const liveAncestor = (n) => {
    let cur = byId.get(n.parentId);
    for (let i = 0; cur && i < 6; i++) {
      const live = (cur.properties || []).find((p) => p.name === "live");
      if (live && live.value?.value !== "off") return cur;
      cur = byId.get(cur.parentId);
    }
    return null;
  };
  const seen = new Map();
  const out = [];
  for (const n of nodes) {
    if (n.ignored || !inScope(n)) continue;
    const role = n.role?.value || "";
    let name = (n.name?.value || "").replace(/\s+/g, " ").trim();
    const value = (n.value?.value || "").replace(/\s+/g, " ").trim();
    if (role === "StaticText") {
      const live = liveAncestor(n);
      if (!live) continue;
      const parent = (live.name?.value || byId.get(live.parentId)?.name?.value || "live").slice(0, 40);
      const key = `live|${parent}`;
      const ord = seen.get(key) || 0;
      seen.set(key, ord + 1);
      const id = hash(`${key}#${ord}`);
      out.push({ id, role: "live", name: parent, value: name.slice(0, 60) });
      continue;
    }
    if (!KEEP.has(role) || (!name && !value)) continue;
    if (role === "paragraph" && name.length < 60) continue;
    if (!name) name = value;
    const key = `${role}|${name.slice(0, 80)}`;
    const ord = seen.get(key) || 0;
    seen.set(key, ord + 1);
    const id = hash(`${key}#${ord}`);
    out.push({ id, role, name: name.slice(0, maxName), value });
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

export function diffStates(a, b) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, n] of b.map) {
    if (!a.map.has(id)) added.push(n);
    else if (a.map.get(id).value !== n.value) changed.push(n);
  }
  for (const [id, n] of a.map) if (!b.map.has(id)) removed.push(n);
  const lines = [
    ...group(removed, "-"),
    ...group(added, "+"),
    ...changed.map((n) => `~ ${n.role} ${n.name} = ${n.value}`),
  ].join("\n");
  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    text: lines,
    chars: lines.length,
    tokens: estimateTokens(lines.length),
    empty: lines.length === 0,
  };
}

function group(list, sign) {
  if (list.length === 0) return [];
  if (list.length <= 5) return list.map((n) => `${sign} ${n.role} ${n.name}${n.value ? " = " + n.value : ""}`);
  const byRole = new Map();
  for (const n of list) byRole.set(n.role, [...(byRole.get(n.role) || []), n]);
  return [...byRole].map(([role, items]) =>
    `${sign} ${items.length} ${role} e.g. ${items.slice(0, 3).map((n) => n.name + (n.value ? " = " + n.value : "")).join(", ")}`
  );
}

export function projectState(state, query, options = {}) {
  const max = options.max ?? 4000;
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (terms.length === 0) return null;
  const hits = state.nodes.filter((n) => terms.some((t) => n.name.toLowerCase().includes(t)));
  if (hits.length === 0) return null;
  const lines = hits.slice(0, max).map((n) => `${n.id} ${n.role} ${n.name}${n.value ? " = " + n.value : ""}`);
  const text = lines.join("\n");
  return {
    nodes: hits.slice(0, max),
    text,
    chars: text.length,
    tokens: estimateTokens(text.length),
    matched: hits.length,
  };
}

export function stateText(state) {
  return state.text;
}

function hash(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

export function isLiveRole(role) {
  return LIVE_ROLES.has(role);
}
