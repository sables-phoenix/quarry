import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Message = { id?: number; result?: unknown; error?: { message?: string } };

test("mcp saves and finds a playbook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quarry-mcp-"));
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, QUARRY_PLAYBOOKS: dir },
  });
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
      setTimeout(() => reject(new Error(`timeout ${method}`)), 10000);
    });
  try {
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "quarry-test", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = (await send("tools/list", {})) as { result?: { tools?: Array<{ name: string }> } };
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    assert.ok(names.includes("browser_playbook_save"));
    assert.ok(names.includes("browser_playbook_find"));
    assert.ok(names.includes("browser_playbook_run"));
    const saved = (await send("tools/call", {
      name: "browser_playbook_save",
      arguments: { site: "example.com", goal: "read the docs", url: "https://example.com/docs", steps: [{ op: "click", role: "link", name: "Docs" }] },
    })) as { result?: { structuredContent?: { id?: string } } };
    const playbookId = saved.result?.structuredContent?.id;
    assert.equal(typeof playbookId, "string");
    const found = (await send("tools/call", {
      name: "browser_playbook_find",
      arguments: { site: "example.com", goal: "find the documentation" },
    })) as { result?: { content?: Array<{ text?: string }> } };
    assert.match(found.result?.content?.[0]?.text ?? "", new RegExp(String(playbookId)));
  } finally {
    child.kill();
  }
});
