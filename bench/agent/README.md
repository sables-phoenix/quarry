# model-driven benchmark

status: blocked. no model API key is present in this environment.

the scripted benchmarks measure what each tool returns. they do not measure a model choosing the next action. the gate for the browser layer needs a real planner:

- one model, same prompt, both arms.
- 10 tasks on real sites.
- exact o200k tokens on every observation.
- model calls and wall clock including inference.
- 5 alternating runs.
- gate: 10x median fewer tokens, 95 percent success, and a caught regression every run.

plan shape, once a key exists:

```json
{
  "task": "hire the cv tailor and stop at checkout",
  "planner": "openai:gpt-5.3",
  "arms": ["chrome-devtools-mcp", "quarry-browser"],
  "runs": 5
}
```

the harness must drive the tools over MCP, not reimplement them. chrome-devtools mcp and quarry-browser mcp are both configured in this environment.
