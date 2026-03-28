# Ruflo for Codex CLI
## Complete prompt/context for headless and automation workflows

Use this guide when running Codex CLI directly, especially for scripted, CI, or non-interactive execution.

---

## Setup (once per machine)

```bash
# Install Claude Flow + Codex helper
npm install -g claude-flow@alpha
npm install -g @claude-flow/codex

# Optional for dual-mode workflows
npm install -g @anthropic-ai/claude-code

# Verify
claude-flow --version
codex --version
```

---

## Register Ruflo MCP in Codex

```bash
codex mcp list
codex mcp add ruflo -- npx ruflo mcp start
```

If your environment standardizes on `claude-flow@alpha` naming, keep the MCP command aligned to that installation pattern.

---

## Critical execution truth (must follow)

- `swarm_init`, `agent_spawn`, and related MCP calls manage orchestration metadata and state.
- In headless Codex runs, they do **not** guarantee real OS-level parallel processes.
- For actual parallelism, fork separate CLI processes with `&` and synchronize with `wait`.

Real parallel pattern:

```bash
codex --session-id "agent-researcher" "Review summaryService.ts for bottlenecks" &
codex --session-id "agent-architect"  "Design diagnostics data model for Notadio" &
codex --session-id "agent-tester"     "Write tests for summary diagnostics API" &
wait
```

This is the only dependable pattern for true concurrent execution in shell-driven Codex flows.

---

## Baseline Codex workflow

```bash
# Single task
codex "implement pagination for the /users endpoint"

# Session-scoped task
codex --session-id "feat-pagination" "add cursor-based pagination to /users"
```

For multi-step objectives:

1. Run a planner/researcher session first.
2. Fork implementation/testing sessions in parallel with `&`.
3. Run a reviewer session after `wait`.

---

## Ruflo full-use workflow in Codex mode

```bash
# 1) Prime memory/context
claude-flow memory search "task keywords" --limit 10

# 2) Initialize orchestration state
claude-flow hive init --topology hierarchical --agents 5

# 3) Start one orchestrated pass
claude-flow orchestrate "your objective" --agents 5 --parallel

# 4) Fork real workers for throughput
codex --session-id "worker-a" "subtask A" &
codex --session-id "worker-b" "subtask B" &
wait

# 5) Persist outcomes
claude-flow memory store "patterns/your-objective" "approach + constraints + gotchas"

# 6) Measure
claude-flow performance report --format summary
```

---

## Non-interactive / CI patterns

Official non-interactive guide emphasizes machine-readable output and explicit headless flags:

```bash
npx claude-flow@alpha swarm "analyze code quality and security" \
  --no-interactive \
  --output-format json \
  --output-file analysis-results.json
```

For stream processing:

```bash
npx claude-flow@alpha automation run-workflow workflow.json \
  --claude \
  --non-interactive \
  --output-format stream-json
```

---

## Dual-mode templates (recommended when available)

```bash
# Discover templates
npx @claude-flow/codex dual templates

# Run full pipeline
npx @claude-flow/codex dual run --template feature  --task "Add OAuth2 login"
npx @claude-flow/codex dual run --template security --task "src/auth/"
npx @claude-flow/codex dual run --template refactor --task "src/legacy/"
```

Use template pipelines for repeatable stages; use explicit `codex ... &` workers when you need hard guarantees of parallel execution.

---

## Operational guardrails

- Use unique `--session-id` values for every worker.
- Keep subtasks independent to avoid file-lock and merge conflicts.
- Prefer short, bounded worker prompts with clear output contracts.
- Always run a final consolidation/review pass after `wait`.
- Persist successful patterns to memory for future task acceleration.

---

## Canonical references

- [Ruflo Wiki Home](https://github.com/ruvnet/ruflo/wiki)
- [MCP Tools](https://github.com/ruvnet/ruflo/wiki/MCP-Tools)
- [Non-Interactive Mode](https://github.com/ruvnet/ruflo/wiki/Non-Interactive-Mode)
- [Installation Guide](https://github.com/ruvnet/ruflo/wiki/Installation-Guide)
- [Quick Start](https://github.com/ruvnet/ruflo/wiki/Quick-Start)

