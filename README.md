# Agent Guard — Loop Detection & Runtime Governance for AI Agents

Runtime-internal **tool call governance hook** — loop detection + post-execution verification that runs inside the agent runtime, not as an external proxy.

> **OpenClaw plugin** — installs in 30 seconds. If you use a different agent framework, the [detection logic](src/index.ts) is open-source and portable.

## Why you need this

In 2026, AI agents are deleting databases, forging recovery reports, and looping for 13 hours straight — all while returning 200 OK. Real incidents:

- **Amazon Kiro**: 13 hours of meaningless code changes, no alerts triggered
- **Replit**: Agent deleted entire codebase during "cleanup"
- **PocketOS**: Agent deleted production DB **and backups** (logically consistent, catastrophically wrong)
- **Gemini**: Fabricated "recovery successful" reports instead of admitting failure
- **n8n**: 50% probability of infinite tool-call loops (GitHub issue #13525)

**88% of organizations** report AI agent security incidents (Deloitte/MIT). Only **21%** have governance mechanisms in place.

Observability tools (AgentOps, LangSmith) tell you what happened *after* it's too late. Policy engines (Salus, Microsoft AGT) check *before* execution but miss loops and silent failures. **Agent Guard catches what slips through both** — repetitive loops and post-execution anomalies — from inside the runtime.

## What it does

Agent Guard hooks into OpenClaw's `before_tool_call` and `after_tool_call` events, detecting when an agent falls into repetitive loops and optionally blocking the offending tool call before it executes.

This is the **Layer 3** solution to agent self-governance: rules written in files (Layer 2) don't guarantee execution. Plugin hooks are enforced by the platform — they cannot be skipped.

## Loop types detected

| Type | Description | Trigger condition |
|------|-------------|-------------------|
| `action_loop` | Same tool + same parameters repeated | threshold repeats (default 3) |
| `output_loop` | Same tool name with different parameters, no meaningful output | threshold × 2 or ≥ 6 repeats (v0.9.0: productive calls excluded) |
| `error_loop` | Same tool failing consecutively | maxConsecutiveErrors (default 3) |
| `error_cascade` | Different tools all failing (agent pivoting without solving) | maxConsecutiveErrors across 2+ tools |
| `pingPong` | Alternating between two tools without progress (A→B→A→B) | 2+ alternating patterns in window |
| `search_loop` | Repeated searches without finding new information (semantic repetition) | 6+ search calls in window |
| `write_loop` | Repeated writes/edits to the same file (oscillation) | 4+ writes to same file |

## How this relates to OpenClaw's built-in loop detection

OpenClaw has built-in loop detection (`tools.loopDetection`) that covers `genericRepeat`, `knownPollNoProgress`, and `pingPong` — but it's **disabled by default** and uses high thresholds (warning at 10, critical at 20).

Agent Guard complements the built-in:

| Feature | OpenClaw Built-in | Agent Guard |
|---------|------------------|-------------|
| Default state | OFF (rolling), ON (post-compaction only) | ON (all detectors) |
| Detection speed | 10-20 repeats | 3-5 repeats |
| output_loop | ❌ | ✅ (with result filtering) |
| search_loop | ❌ | ✅ (v0.10.0: semantic repetition) |
| error_loop | ❌ | ✅ |
| error_cascade | ❌ | ✅ |
| pingPong | ✅ | ✅ |
| Post-compaction guard | ✅ (excellent) | ❌ (plugin scope) |
| State verification | ❌ | ✅ (5 check types) |
| Recovery suggestions | ❌ | ✅ |

**Use both.** OpenClaw's post-compaction guard is irreplaceable. Agent Guard catches loops earlier and covers types the built-in misses.

## Quick Start

```bash
# 1. Install
openclaw plugins install --link /path/to/agent-guard-plugin

# 2. Restart
openclaw gateway restart

# 3. That's it — loop detection is on by default (blockOnLoop=false, observe-only)
```

After 1-2 days, check `hook-proof.jsonl` for detected loops. Then consider enabling `blockOnLoop: true`.

## Installation (detailed)

```bash
openclaw plugins install --link /path/to/agent-guard-plugin
openclaw gateway restart
```

## Known Limitations

Agent Guard operates at the **tool-call hook level**. It cannot detect:

- **Semantic repetition**: Same intent expressed with different words/params (e.g., after context compaction, agent repeats the same action with slightly different phrasing). See [OpenClaw #76938](https://github.com/openclaw/openclaw/issues/76938).
- **Session-level loops**: Infinite loops in session/event architecture, not in tool calls. See [OpenClaw #91307](https://github.com/openclaw/openclaw/issues/91307).
- **Simulated tool calls**: Model outputs tool-call-like text instead of actually invoking the tool. See [OpenClaw #45049](https://github.com/openclaw/openclaw/issues/45049).
- **Infrastructure loops**: Gateway restart loops, event loop starvation. These are outside agent behavior scope.

For these scenarios, use OpenClaw's built-in post-compaction guard (catches semantic repetition after compaction) and infrastructure monitoring tools.

## Configuration

In `openclaw.config.yaml`:

```yaml
plugins:
  entries:
    agent-guard:
      config:
        enabled: true
        blockOnLoop: false          # Set true to block tool calls on loop detection
        loopThreshold: 2            # Repeats needed for action_loop detection
        loopWindowMs: 120000        # Time window for counting repeats (2 min)
        maxConsecutiveErrors: 3     # Consecutive errors for error_loop
        blockCooldownMs: 60000      # Cooldown between blocks (prevents cascading)
        logLevel: info
```

## ⚠️ Important: blockOnLoop considerations

When `blockOnLoop=true`, the plugin will **prevent tool execution** on detected loops. This is powerful but has risks:

1. **False positives**: Normal agent work (using `exec` 5+ times in sequence) can trigger `output_loop`. The v0.3 threshold of 6 mitigates this.
2. **Cascading blocks**: Without `blockCooldownMs`, a single block can cascade into blocking all subsequent calls. The cooldown (default 60s) prevents this.
3. **Governance tool self-lock**: See [Failure #6](../self-governance-prototype/failures.md) — the governance tool itself can lock the agent if misconfigured. Always start with `blockOnLoop=false` and observe logs first.

**Recommended workflow**: Run with `blockOnLoop=false` for 1-2 days, review `hook-proof.jsonl` logs, then carefully enable blocking.

## Proof file

All hook events are logged to `hook-proof.jsonl` in the plugin directory. Each line is a JSON record:

```json
{"hook":"after_tool_call","ts":"...","sessionId":"...","toolName":"exec","isError":false,"paramsHash":"..."}
{"hook":"loop_detected","ts":"...","sessionId":"...","toolName":"write","loopType":"action_loop","repeats":2,"severity":"high","confidence":0.9}
{"hook":"before_tool_call_blocked","ts":"...","sessionId":"...","toolName":"write","loopType":"action_loop","repeats":2,"severity":"high"}
```

## Validation results

Four-stage validation completed on 2026-06-18:

| Stage | Status | Evidence |
|-------|--------|----------|
| Plugin loaded | ✅ | hookCount=2, status=loaded |
| Hooks working | ✅ | after_tool_call fires on every tool call |
| Detecting loops | ✅ | loop_detected records appear |
| Blocking tool calls | ✅ | before_tool_call_blocked record, tool execution prevented |

Key test: Two consecutive `write` calls with identical path+content → `action_loop` detected (repeats=2, severity=high) → tool call blocked → blockReason returned instead of normal execution result.

## v0.9.0 — Reduced output_loop false positives

Analysis of 2,500 hook-proof records revealed that 194 `output_loop` detections on `exec` were mostly **normal sequential shell commands** (git status → git diff → git add → git commit → git push), not real loops.

Fix: `output_loop` detection now tracks whether each tool call produced a meaningful result. Calls that returned nontrivial output are excluded from loop counting. This eliminates the most common false positive pattern while preserving detection of genuine output loops where the agent repeatedly calls the same tool and gets no useful result.

Real user evidence: [OpenClaw #76938](https://github.com/openclaw/openclaw/issues/76938) (agent loops after compaction), [#71273](https://github.com/openclaw/openclaw/issues/71273) (Kimi Code infinite tool call loop).

## Architecture

```
OpenClaw Gateway
  └─ Plugin System
      └─ before_tool_call hook (priority 90)
          └─ Agent Guard: detect loop → block or allow
      └─ after_tool_call hook (priority 80)
          └─ Agent Guard: record action → detect loop → log
```

The key insight: this runs **inside the agent runtime**, not as an external monitor. It's faster, more precise, and harder to bypass than network-layer governance tools.

## Comparison with existing solutions

| Solution | Approach | Layer |
|----------|----------|-------|
| AvePoint AgentPulse | External dashboard/monitoring | Network |
| Portal26 Agentic Token Controls | External throttling/pausing | Network |
| AgentOps | External observability | Network |
| FutureAGI | External loop detection | Network |
| **Agent Guard** | **Runtime-internal hook** | **Platform** |

The Waxell $47k fintech incident root cause: "no mechanism that could have terminated the session before the next API call completed." Agent Guard's `before_tool_call` block IS this mechanism.

## Files

- `src/index.ts` — TypeScript source
- `dist/index.js` — Compiled runtime (used by OpenClaw)
- `openclaw.plugin.json` — Plugin manifest
- `package.json` — Dependencies (openclaw/plugin-sdk)
