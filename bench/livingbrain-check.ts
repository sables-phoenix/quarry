import { readFileSync } from "node:fs";

type Report = {
  status?: string;
  reason?: string;
  captures?: number;
  completed?: number;
  exact_matches?: number;
  search?: { queries?: number; top1?: number; top3?: number };
  pass?: boolean;
};

const path = new URL("./livingbrain.json", import.meta.url);
let report: Report;
try {
  report = JSON.parse(readFileSync(path, "utf8")) as Report;
} catch {
  console.error("FAIL: bench/livingbrain.json missing or invalid");
  process.exit(1);
}

if (report.status === "blocked") {
  console.error(`BLOCKED: ${report.reason ?? "unknown"}`);
  process.exit(2);
}

const failures: string[] = [];
if (report.status !== "measured") failures.push("status is not measured");
if ((report.captures ?? 0) !== 10) failures.push(`captures ${report.captures ?? 0} != 10`);
if ((report.completed ?? 0) < 9) failures.push(`completed ${report.completed ?? 0} < 9`);
if ((report.exact_matches ?? 0) < 9) failures.push(`exact_matches ${report.exact_matches ?? 0} < 9`);
if (!report.search || (report.search.queries ?? 0) < 30) failures.push(`search queries ${report.search?.queries ?? 0} < 30`);
if ((report.search?.top3 ?? 0) < 0.9) failures.push(`search top3 ${report.search?.top3 ?? 0} < 0.9`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.error(`PASS: ${report.exact_matches}/10 exact, search top3 ${report.search?.top3}, top1 ${report.search?.top1}`);
