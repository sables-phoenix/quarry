import { readFileSync } from "node:fs";

const mode = process.argv[2];

function load(file: string): { summary: Record<string, number | string> } {
  return JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8")) as { summary: Record<string, number | string> };
}

if (mode === "text") {
  const { summary } = load("results.json");
  const ok = Number(summary.ok);
  const html = Number(summary.median_html_ratio);
  const cold = Number(summary.cold_ms_p50);
  const warm = Number(summary.warm_ms_p50);
  if (ok < 15) throw new Error(`only ${ok} pages measured`);
  if (html < 5) throw new Error(`html ratio ${html}`);
  if (!(warm < cold)) throw new Error(`warm ${warm} not faster than cold ${cold}`);
  console.log(`text ok=${ok} html_ratio=${html} cold=${cold} warm=${warm}`);
} else if (mode === "select") {
  const { summary } = load("select.json");
  const recall = Number(summary.recall);
  const ratio = Number(summary.total_ratio);
  if (recall < 0.8) throw new Error(`recall ${recall}`);
  if (ratio < 3) throw new Error(`selection ratio ${ratio}`);
  console.log(`select recall=${recall} total_ratio=${ratio}`);
} else if (mode === "external") {
  const { summary } = load("external.json");
  const ratio = Number(summary.median_token_ratio);
  if (!(ratio > 1)) throw new Error(`external token ratio ${ratio}`);
  console.log(`external median_token_ratio=${ratio}`);
} else {
  throw new Error(`usage: check.ts <text|select|external>`);
}
