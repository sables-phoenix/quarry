import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { tokenCount } from "../../browser/dist/state.js";

const URLS = [
  "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
  "https://react.dev/reference/react/useState",
  "https://github.com/rust-lang/rust",
  "https://en.wikipedia.org/wiki/HTTPS",
 ];

type Message = { id?: number; result?: unknown; error?: { message?: string } };

export async function runMcpBaselines(): Promise<void> {
  const child = spawn("chrome-devtools-mcp", ["--headless", "--isolated", "--viewport", "1280x800", "--executablePath", process.env.CHROME ?? "/home/opencode/chrome-headless-shell"], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (message: Message) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line) as Message;
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)!(message);
        pending.delete(message.id);
      }
    } catch {
      return;
    }
  });
  let id = 0;
  const send = (method: string, params: Record<string, unknown>): Promise<Message> =>
    new Promise((resolve, reject) => {
      const current = ++id;
      pending.set(current, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`);
      setTimeout(() => reject(new Error(`timeout ${method}`)), 90000);
    });
  try {
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "quarry-bench", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = (await send("tools/list", {})) as { result?: { tools?: Array<{ name: string }> } };
    const names = new Set((listed.result?.tools ?? []).map((tool) => tool.name));
    if (process.env.SCHEMA) {
      for (const tool of listed.result?.tools ?? []) {
        if (["new_page", "navigate_page", "take_snapshot", "list_pages"].includes(tool.name)) console.error(tool.name, JSON.stringify(tool));
      }
      return;
    }
    if (!names.has("take_snapshot")) throw new Error(`take_snapshot missing: ${[...names].join(",")}`);
    const rows: Array<Record<string, unknown>> = [];
    for (const url of URLS) {
      const created = (await send("tools/call", { name: "new_page", arguments: { url } })) as {
        result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: { pageId?: number } };
      };
      const listText = created.result?.content?.[0]?.text ?? "";
      const ids = [...listText.matchAll(/^(\d+):/gm)].map((match) => Number(match[1]));
      const pageId = created.result?.structuredContent?.pageId ?? Math.max(...ids);
      if (process.env.ONE) console.error("created", JSON.stringify(created).slice(0, 800));
      const snapshot = (await send("tools/call", { name: "take_snapshot", arguments: { pageId } })) as {
        result?: { content?: Array<{ type: string; text?: string }> };
      };
      const text = (snapshot.result?.content ?? [])
        .filter((content) => content.type === "text")
        .map((content) => content.text ?? "")
        .join("\n");
      console.error(url, JSON.stringify(text.slice(0, 300)));
      rows.push({ url, chars: text.length, tokens: tokenCount(text) });
    }
    writeFileSync(new URL("./baselines-mcp.json", import.meta.url), JSON.stringify({ method: "chrome-devtools-mcp take_snapshot, o200k", rows }, null, 2));
    console.log(JSON.stringify({ rows }, null, 2));
  } finally {
    child.kill();
  }
}

await runMcpBaselines();
