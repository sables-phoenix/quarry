import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LivingBrain, LivingBrainError, livingBrainConfig } from "../browser/dist/livingbrain.js";
import { PlaybookStore } from "../browser/dist/playbook.js";
import type { Playbook } from "../browser/dist/playbook.js";

const SITES = [
  ["klawva.xyz", "hire cv tailor"],
  ["github.com", "open issues"],
  ["developer.mozilla.org", "read etag"],
  ["react.dev", "use state"],
  ["en.wikipedia.org", "view history"],
  ["stripe.com", "create payment link"],
  ["linear.app", "create issue"],
  ["notion.so", "create page"],
  ["example.com", "open docs"],
  ["httpbin.org", "check status"],
] as const;

const QUERIES: Record<string, string[]> = {
  "klawva.xyz": ["start a cv tailoring booking", "recruit a resume specialist", "hire a cv writer"],
  "github.com": ["go to the bug tracker", "list proposed changes", "find a repository"],
  "developer.mozilla.org": ["revalidate a cached file", "stop a response being stored", "vary on a header"],
  "react.dev": ["add local component state", "run an effect after render", "manage state with a reducer"],
  "en.wikipedia.org": ["read an encyclopedia entry", "see past edits", "open the discussion"],
  "stripe.com": ["make a checkout link", "read the developer reference", "find the merchant console"],
  "linear.app": ["file a new task", "see the product plan", "change workspace preferences"],
  "notion.so": ["add a new document", "add a teammate", "browse document templates"],
  "example.com": ["open the documentation", "read the docs page", "find the docs"],
  "httpbin.org": ["check an http status", "inspect a response code", "test a status endpoint"],
};

const stepsFor = (site: string) => [
  { op: "wait_for", text: site, timeout: 5000 },
  { op: "click", role: "link", name: "open" },
  { op: "fill", role: "textbox", name: "query", value: "demo" },
];
const assertsFor = () => [{ op: "text", value: "done" }];

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLivingBrain(): Promise<void> {
  const config = livingBrainConfig();
  if (!config) {
    await writeFile(new URL("./livingbrain.json", import.meta.url), JSON.stringify({ status: "blocked", reason: "missing_config", pass: false }, null, 2) + "\n");
    console.error("blocked: set LIVING_BRAIN_API_KEY, LIVING_BRAIN_SUBJECT_ID and LIVING_BRAIN_BRAIN_ID");
    process.exit(2);
  }
  const brain = new LivingBrain(config);
  const dir = await mkdtemp(join(tmpdir(), "quarry-livingbrain-"));
  const store = new PlaybookStore(dir);
  const playbooks: Array<{ playbook: Playbook; content: string }> = [];
  for (const [site, goal] of SITES) {
    const steps = stepsFor(site);
    const asserts = assertsFor();
    const playbook = await store.save({ site, goal, url: `https://${site}/`, steps: steps as never, asserts: asserts as never });
    const content = [
      `# ${site} ${goal}`,
      "",
      `Site: ${site}`,
      `Goal: ${goal}`,
      `quarry-playbook-id: ${playbook.id}`,
      "",
      "Keep this block byte-for-byte.",
      "",
      "```json",
      JSON.stringify(steps, null, 2),
      "```",
      "",
      "```json",
      JSON.stringify(asserts, null, 2),
      "```",
    ].join("\n");
    playbooks.push({ playbook, content });
  }

  const sources: Array<{ id: string; status: string; lastError?: string }> = [];
  try {
    for (const item of playbooks) {
      const source = await brain.captureContent(item.content, `${item.playbook.site} ${item.playbook.goal}`, `quarry:fidelity:${item.playbook.id}`);
      sources.push({ id: source.id, status: source.status, lastError: source.lastError });
    }
  } catch (error) {
    if (error instanceof LivingBrainError && error.status === 402) {
      const payload = { status: "blocked", reason: "insufficient_balance", code: error.code, http: error.status, pass: false };
      await writeFile(new URL("./livingbrain.json", import.meta.url), JSON.stringify(payload, null, 2) + "\n");
      console.error("blocked: insufficient balance");
      process.exit(2);
    }
    throw error;
  }

  const deadline = Date.now() + 240000;
  let statuses: Array<{ id: string; status: string; lastError?: string }> = [];
  while (Date.now() < deadline) {
    statuses = await brain.listSources();
    const pending = sources.some((source) => {
      const current = statuses.find((item) => item.id === source.id);
      return current && ["pending", "compiling"].includes(current.status);
    });
    if (!pending) break;
    await sleep(5000);
  }

  const completed = sources.filter((source) => statuses.find((item) => item.id === source.id)?.status === "completed");
  const exact: Array<{ site: string; ok: boolean; slug?: string; error?: string }> = [];
  const searchRows: Array<{ site: string; top1: boolean; top3: boolean }> = [];
  for (const item of playbooks) {
    const results = await brain.search(item.playbook.site, item.playbook.goal, 5);
    let matchedSlug: string | null = null;
    let exactOk = false;
    for (const result of results) {
      const page = await brain.getPage(result.slug);
      const block = String(page.body ?? "").match(/```json\s*([\s\S]*?)```/);
      if (block) {
        try {
          const parsed = JSON.parse(block[1]!);
          if (canonical(parsed) === canonical(item.playbook.steps)) {
            exactOk = true;
            matchedSlug = result.slug;
            break;
          }
        } catch {
          continue;
        }
      }
    }
    exact.push({ site: item.playbook.site, ok: exactOk, slug: matchedSlug ?? undefined });
  }

  for (const item of playbooks) {
    const queries = QUERIES[item.playbook.site] ?? [item.playbook.goal];
    for (const query of queries) {
      const results = await brain.search(item.playbook.site, query, 5);
      const expected = results.findIndex((result) => result.title.toLowerCase().includes(item.playbook.site.split(".")[0]!));
      searchRows.push({ site: item.playbook.site, top1: expected === 0, top3: expected >= 0 && expected < 3 });
    }
  }

  const output = {
    status: "measured",
    pass: false,
    model: config.baseUrl,
    captures: playbooks.length,
    completed: completed.length,
    exact_matches: exact.filter((row) => row.ok).length,
    exact,
    sources: sources.map((source) => ({ id: source.id, status: statuses.find((item) => item.id === source.id)?.status ?? "unknown", lastError: statuses.find((item) => item.id === source.id)?.lastError })),
    search: {
      queries: searchRows.length,
      top1: searchRows.length ? Number((searchRows.filter((row) => row.top1).length / searchRows.length).toFixed(3)) : 0,
      top3: searchRows.length ? Number((searchRows.filter((row) => row.top3).length / searchRows.length).toFixed(3)) : 0,
    },
  };
  output.pass = output.completed >= 9 && output.exact_matches >= 9 && output.search.top3 >= 0.9;
  await writeFile(new URL("./livingbrain.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output, null, 2));
}

await runLivingBrain();
