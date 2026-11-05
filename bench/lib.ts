import { encode } from "gpt-tokenizer";
import { parseDocument } from "htmlparser2";
import { isTag, isText } from "domhandler";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

export const BIN = process.env.QUARRY_BIN ?? "target/release/quarry";
export const UA = "Mozilla/5.0 (compatible; quarry-bench/0.1)";

export function tokens(text: string): number {
  return encode(text).length;
}

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "canvas"]);

export function visibleText(html: string): string {
  const doc = parseDocument(html);
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (isText(node as never)) {
      parts.push((node as { data: string }).data);
      return;
    }
    if (isTag(node as never) && SKIP.has((node as { name: string }).name)) return;
    const children = (node as { children?: unknown[] }).children ?? [];
    for (const child of children) walk(child);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export type Baseline = {
  status: number;
  bytes: number;
  htmlChars: number;
  htmlTokens: number;
  textChars: number;
  textTokens: number;
  ms: number;
};

export async function fetchBaseline(url: string): Promise<Baseline> {
  const started = performance.now();
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
  const html = await response.text();
  const ms = performance.now() - started;
  const text = visibleText(html);
  return {
    status: response.status,
    bytes: Buffer.byteLength(html, "utf8"),
    htmlChars: html.length,
    htmlTokens: tokens(html),
    textChars: text.length,
    textTokens: tokens(text),
    ms,
  };
}

export type QuarryDoc = {
  url: string;
  final_url: string;
  title: string;
  text: string;
  chars: number;
  tokens_est: number;
  content_type: string;
  status: number;
  fetched_ms: number;
  bytes_body: number;
  cache: string;
  truncated: boolean;
};

export async function quarry(args: string[], cacheDir?: string): Promise<QuarryDoc> {
  const full = cacheDir ? ["--cache-dir", cacheDir, ...args] : args;
  const { stdout } = await run(BIN, full, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as QuarryDoc;
}

export async function withCache<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "quarry-bench-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
