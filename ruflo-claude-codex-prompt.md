# Ruflo Prompt Pack Index
## Claude CLI + Codex CLI (split guides)

This file is now the index for two dedicated prompt/context files:

- `ruflo-claude-prompt.md` (interactive Claude Code focus)
- `ruflo-codex-prompt.md` (headless Codex focus + real parallelism rules)

Use this split to avoid mixing execution assumptions between platforms.

---

## Why this split is required

- Claude Code and Codex CLI do not execute orchestration loops in the same way.
- MCP swarm primitives (`swarm_init`, `agent_spawn`, `task_orchestrate`) are orchestration/state tools, not guaranteed OS-level parallel workers in headless Codex execution.
- Codex true concurrency is process-level (`&` + `wait`) unless a wrapper explicitly forks workers.

---

## Verified source docs (GitHub wiki)

- [Home](https://github.com/ruvnet/ruflo/wiki)
- [Installation Guide](https://github.com/ruvnet/ruflo/wiki/Installation-Guide)
- [Init Commands](https://github.com/ruvnet/ruflo/wiki/Init-Commands)
- [Quick Start](https://github.com/ruvnet/ruflo/wiki/Quick-Start)
- [MCP Tools](https://github.com/ruvnet/ruflo/wiki/MCP-Tools)
- [Non-Interactive Mode](https://github.com/ruvnet/ruflo/wiki/Non-Interactive-Mode)

---

## Quick start

```bash
# Install prerequisites once
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
npm install -g claude-flow@alpha
npm install -g @claude-flow/codex

# Open the right guide for your session mode
# - interactive: ruflo-claude-prompt.md
# - headless/automation: ruflo-codex-prompt.md
```

---

## Dual-mode recommended path

```bash
# Template-driven dual execution
npx @claude-flow/codex dual templates
npx @claude-flow/codex dual run --template feature --task "Your task"
```

If you need guaranteed parallel worker execution in Codex CLI, use process forking:

```bash
codex --session-id "worker-1" "Subtask A" &
codex --session-id "worker-2" "Subtask B" &
wait
```
