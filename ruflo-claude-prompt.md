# Ruflo for Claude Code CLI
## Complete prompt/context for interactive orchestration

Use this guide when working in `claude` interactive sessions with Ruflo/Claude-Flow.

---

## Setup (once per machine)

```bash
# Required by official docs
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
npm install -g claude-flow@alpha

# Optional but recommended for dual mode
npm install -g @claude-flow/codex

# Verify
claude --version
claude-flow --version
```

---

## Project initialization modes

```bash
# Standard
npx claude-flow@alpha init

# Verification-first (95% truth threshold workflows)
npx claude-flow@alpha init --verify

# Pair programming workflow
npx claude-flow@alpha init --pair

# Full strict mode
npx claude-flow@alpha init --verify --pair
```

Use `--force` to overwrite an existing `CLAUDE.md`.

---

## Core execution model (Claude interactive)

- `claude-flow` coordinates swarm, memory, and orchestration policies.
- Claude Code session performs code reasoning and edits with interactive context.
- MCP tools are first-class and can be invoked in conversation loops.

---

## Essential orchestration workflow

```bash
# 1) Initialize swarm for task complexity
claude-flow hive init --topology hierarchical --agents 5

# 2) Run orchestrated objective
claude-flow orchestrate "implement authentication module with tests" --agents 5 --parallel

# 3) Monitor in real time
claude-flow hive monitor --live

# 4) Persist useful context
claude-flow memory store "patterns/auth-module" "JWT + refresh + role middleware"

# 5) Inspect execution quality
claude-flow performance report --format summary
```

---

## SPARC modes (high-value defaults)

```bash
claude-flow sparc run dev      "build a user auth system"
claude-flow sparc run api      "user management REST API with OpenAPI docs"
claude-flow sparc run tdd      "authentication module with full test coverage"
claude-flow sparc run test     "integration tests for payment API"
claude-flow sparc run refactor "optimize database query layer"
claude-flow sparc run ui       "dashboard component with React"
```

---

## MCP tools inside Claude sessions

Call pattern:

```txt
mcp__claude-flow__<tool_name>(...)
```

Common core:

```txt
mcp__claude-flow__memory_search(...)
mcp__claude-flow__swarm_init(...)
mcp__claude-flow__agent_spawn(...)
mcp__claude-flow__task_orchestrate(...)
mcp__claude-flow__memory_usage(...)
```

Notes:

- Use MCP tools for orchestration state, memory, and execution strategy.
- Keep one active objective at a time, then persist outputs as reusable memory patterns.

---

## Tiered operating playbook

```bash
# Tier 1: Quick fixes
claude-flow orchestrate "fix null-check in parser" --agents 1

# Tier 2: Medium features
claude-flow hive init --topology mesh --agents 3
claude-flow orchestrate "add email verification" --parallel

# Tier 3: Architecture-level work
claude-flow hive init --topology hierarchical --agents 8
claude-flow sparc run dev "build complete payment module"
claude-flow hive monitor --live
```

---

## Health, config, and recovery

```bash
claude-flow config set hive.defaultTopology hierarchical
claude-flow config set memory.retention 30d
claude-flow health check --verbose
claude-flow reset --hard && claude-flow init
```

Environment tuning:

```bash
export CLAUDE_FLOW_MAX_AGENTS=12
export CLAUDE_FLOW_MEMORY_SIZE=2GB
export CLAUDE_FLOW_ENABLE_NEURAL=true
```

---

## Dual-mode handoff from Claude

When interactive planning is done and you need batch throughput:

```bash
npx @claude-flow/codex dual run --template feature --task "Add summary diagnostics"
```

If templates are not suitable, fork workers directly with Codex (see `ruflo-codex-prompt.md`).

---

## Canonical references

- [Ruflo Wiki Home](https://github.com/ruvnet/ruflo/wiki)
- [Installation Guide](https://github.com/ruvnet/ruflo/wiki/Installation-Guide)
- [Init Commands](https://github.com/ruvnet/ruflo/wiki/Init-Commands)
- [Quick Start](https://github.com/ruvnet/ruflo/wiki/Quick-Start)
- [MCP Tools](https://github.com/ruvnet/ruflo/wiki/MCP-Tools)

