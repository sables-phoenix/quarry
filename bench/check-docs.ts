import { readFileSync } from "node:fs";

const files = ["README.md", "BROWSER.md", "browser/README.md", "RESULTS.md"];
const banned: Array<[RegExp, string]> = [
  [/30 vs 20/, "unsupported model-call claim"],
  [/dom snapshot per step/i, "unsupported DOM baseline"],
  [/63x faster/, "unmeasured latency claim"],
  [/10 tokens and zero model calls/, "stale replay token claim"],
];
const problems: string[] = [];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const [pattern, reason] of banned) {
    if (pattern.test(text)) problems.push(`${file}: ${reason}`);
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("docs clean");
