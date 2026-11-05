import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (!process.env.CHROME) {
  const local = join(homedir(), "chrome-headless-shell");
  if (existsSync(local)) process.env.CHROME = local;
}

const run = (command: string, args: string[], cwd = process.cwd()) => {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
};

run("npm", ["--prefix", "browser", "run", "build"]);
run("npx", ["tsx", "bench/text.ts"]);
run("npx", ["tsx", "bench/select.ts"]);
try {
  run("npx", ["tsx", "bench/external.ts"]);
} catch {
  console.warn("external bench failed");
}
run("npx", ["tsx", "bench/browser/fixtures.ts"]);
run("npx", ["tsx", "bench/playbook.ts"]);
run("npx", ["tsx", "bench/browser/baselines-mcp.ts"]);
try {
  run("npx", ["tsx", "bench/browser/real-flows.ts"]);
  run("npx", ["tsx", "bench/browser/nav-flows.ts"]);
  run("npx", ["tsx", "bench/browser/ladder.ts"]);
  run("npx", ["tsx", "bench/browser/js-pages.ts"]);
} catch {
  console.warn("real-flow bench failed");
}
try {
  run("npx", ["tsx", "bench/browser/klawva.ts"]);
} catch {
  console.warn("klawva bench failed");
}
run("npx", ["tsx", "bench/summary.ts"]);
