import { writeFileSync } from "node:fs";
import { Effect } from "effect";
import { Session } from "../browser/dist/session.js";
import { serveFixtures } from "../browser/dist/server.js";
import type { Flow } from "../browser/dist/types.js";

const RUNS = 10;

const KLAWVA: Flow = {
  url: "https://klawva.xyz/employees",
  steps: [
    { op: "wait_for", text: "Cv Tailor", timeout: 8000 },
    { op: "click", role: "link", name: "Cv Tailor" },
    { op: "wait_for", text: "HIRE KLAWVA CV TAILOR", timeout: 8000 },
    { op: "click", role: "button", name: "HIRE KLAWVA CV TAILOR" },
    { op: "wait_for", text: "PAY AND LAUNCH", timeout: 8000 },
    { op: "fill", role: "textbox", name: "Lagos or remote", value: "Remote" },
    { op: "fill", role: "textbox", name: "you@example.com", value: "bench@example.com" },
    { op: "click", role: "button", name: "24 hours" },
  ],
  asserts: [{ op: "text", value: "PAY AND LAUNCH" }],
};

const FIXTURE_FLOWS: Array<{ name: string; path: string; flow: Omit<Flow, "url"> }> = [
  {
    name: "login",
    path: "/login.html",
    flow: {
      steps: [
        { op: "fill", role: "textbox", name: "email", value: "ada@example.com" },
        { op: "fill", role: "textbox", name: "password", value: "correct-horse" },
        { op: "click", role: "button", name: "continue" },
      ],
      asserts: [{ op: "text", value: "welcome back" }],
    },
  },
  {
    name: "tabs",
    path: "/tabs.html",
    flow: {
      steps: [{ op: "click", role: "tab", name: "billing" }],
      asserts: [{ op: "text", value: "billing content" }],
    },
  },
  {
    name: "modal",
    path: "/modal.html",
    flow: {
      steps: [{ op: "click", role: "button", name: "delete account" }],
      asserts: [{ op: "text", value: "this cannot be undone" }],
    },
  },
];

const SITES = [
  { site: "klawva.xyz", tasks: ["hire cv tailor", "hire software engineer", "view pricing"] },
  { site: "github.com", tasks: ["open issues", "open pull requests", "search repository"] },
  { site: "developer.mozilla.org", tasks: ["read cache control", "read etag", "read vary"] },
  { site: "react.dev", tasks: ["use state", "use effect", "use reducer"] },
  { site: "en.wikipedia.org", tasks: ["read article", "view history", "open talk page"] },
  { site: "stripe.com", tasks: ["create payment link", "read api docs", "open dashboard"] },
  { site: "linear.app", tasks: ["create issue", "view roadmap", "open settings"] },
  { site: "notion.so", tasks: ["create page", "invite member", "open template gallery"] },
];

const PARAPHRASE: Record<string, string> = {
  "klawva.xyz/hire cv tailor": "start a cv tailoring booking and reach checkout",
  "klawva.xyz/hire software engineer": "recruit an engineer through the hiring flow",
  "klawva.xyz/view pricing": "see what the service costs",
  "github.com/open issues": "go to the bug tracker of a repo",
  "github.com/open pull requests": "list proposed code changes",
  "github.com/search repository": "find a project by name",
  "developer.mozilla.org/read cache control": "learn how to stop a response being stored",
  "developer.mozilla.org/read etag": "find the header used to revalidate a cached file",
  "developer.mozilla.org/read vary": "see how a response depends on a request header",
  "react.dev/use state": "add local component state",
  "react.dev/use effect": "run a side effect after render",
  "react.dev/use reducer": "manage state with a reducer",
  "en.wikipedia.org/read article": "read an encyclopedia entry",
  "en.wikipedia.org/view history": "see past edits to a page",
  "en.wikipedia.org/open talk page": "open the discussion page",
  "stripe.com/create payment link": "make a checkout link for a customer",
  "stripe.com/read api docs": "read the developer reference",
  "stripe.com/open dashboard": "find the merchant console",
  "linear.app/create issue": "file a new task",
  "linear.app/view roadmap": "see the product plan",
  "linear.app/open settings": "change workspace preferences",
  "notion.so/create page": "add a new document",
  "notion.so/invite member": "add a teammate to the workspace",
  "notion.so/open template gallery": "browse document templates",
};

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
const score = (query: string, doc: string) => {
  const queryWords = new Set(words(query));
  const docWords = new Set(words(doc));
  let hits = 0;
  for (const word of queryWords) if (docWords.has(word)) hits += 1;
  return hits / Math.max(queryWords.size, 1);
};

export async function runPlaybook(): Promise<void> {
  const server = await serveFixtures(new URL("../browser/fixtures", import.meta.url).pathname);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const session = await Effect.runPromise(Session.create());
  const replays: Array<Record<string, unknown>> = [];
  try {
    const flows: Array<{ name: string; flow: Flow }> = [
      { name: "klawva", flow: KLAWVA },
      ...FIXTURE_FLOWS.map((item) => ({ name: item.name, flow: { ...item.flow, url: base + item.path } })),
    ];
    for (const item of flows) {
      const runs: Array<Record<string, unknown>> = [];
      for (let run = 0; run < RUNS; run++) {
        const started = performance.now();
        const result = await Effect.runPromise(session.replay(item.flow));
        runs.push({ run, ms: Math.round(performance.now() - started), tokens: result.tokens, ok: result.ok });
      }
      const sorted = [...runs].sort((a, b) => (a.ms as number) - (b.ms as number));
      replays.push({
        name: item.name,
        ok: runs.filter((run) => run.ok).length,
        runs: RUNS,
        median_ms: sorted[Math.floor(sorted.length / 2)]?.ms ?? 0,
        tokens: runs[0]?.tokens ?? 0,
        detail: runs,
      });
    }
  } finally {
    await Effect.runPromise(session.close());
    server.close();
  }

  const docs = SITES.flatMap((site) =>
    site.tasks.map((task) => ({
      key: `${site.site}/${task}`,
      site: site.site,
      text: `${site.site} ${task} playbook steps selectors assertions`,
    }))
  );
  const result = (hinted: boolean) => {
    let top1 = 0;
    let top3 = 0;
    for (const doc of docs) {
      const query = `${PARAPHRASE[doc.key]}${hinted ? ` ${doc.site}` : ""}`;
      const ranked = [...docs]
        .map((candidate) => ({ key: candidate.key, score: score(query, candidate.text) + (hinted && candidate.site === doc.site ? 0.5 : 0) }))
        .sort((a, b) => b.score - a.score);
      const index = ranked.findIndex((item) => item.key === doc.key);
      if (index === 0) top1 += 1;
      if (index >= 0 && index < 3) top3 += 1;
    }
    return { top1: top1 / docs.length, top3: top3 / docs.length };
  };

  const output = {
    tokenizer: "o200k_base",
    replay: replays,
    replay_summary: {
      flows: replays.length,
      runs: replays.reduce((sum, item) => sum + (item.runs as number), 0),
      ok: replays.reduce((sum, item) => sum + (item.ok as number), 0),
    },
    retrieval: {
      docs: docs.length,
      without_site_hint: result(false),
      with_site_hint: result(true),
      method: "token overlap over site, task, and playbook words",
    },
  };
  writeFileSync(new URL("./playbook.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

await runPlaybook();
