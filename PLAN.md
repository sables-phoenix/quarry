# quarry

goal: a web access layer for coding agents that beats the built-in websearch and webfetch tools on tokens, latency, and bytes, and works across opencode, codex, and claude code.

## constraints

- no code comments anywhere
- readme fully lowercase
- benchmark before and after, real numbers
- verification skill that drives the real binary
- security review before every push

## phases

1. research: landscape, extraction, transport, benchmarks
2. design: one interface, measurable targets
3. build: rust core, mcp server, cli
4. benchmark: baseline vs quarry on a fixed corpus
5. verify: project-local verification skill
6. ship: repo, readme, security pass
