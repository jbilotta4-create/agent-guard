# Agent Guard — Runtime Loop Detection & State Verification for AI Agents

OpenClaw plugin that hooks into `before_tool_call` and `after_tool_call` to automatically detect when an agent is stuck in a loop — and optionally block the offending tool call before it executes.

**Now with State Verification (v0.8.0):** After a tool call completes, Agent Guard verifies that the claimed effect actually happened. "200 OK but nothing changed" is the silent failure that kills agent reliability.

## What it does

1. **Loop Detection** — Catches three failure modes: repeated identical actions, repeated tool calls with varying parameters, and consecutive errors
2. **State Verification** (v0.8.0) — After `write`/`edit`/`exec`, checks that files actually exist, content was applied, commands succeeded
3. **Blocking** — When `blockOnLoop=true`, prevents tool execution on detected loops or consecutive verification failures

This runs **inside the agent runtime**, not as an external monitor. Faster, more precise, and harder to bypass than network-layer governance tools.

## Loop types detected

| Type | Description | Trigger condition |
|------|-------------|-------------------|
| `action_loop` | Same tool + same parameters repeated | threshold repeats (default 3) |
| `output_loop` | Same tool name with different parameters | threshold repeats, different params |
| `error_loop` | Consecutive tool call errors | maxConsecutiveErrors (default 3) |

## State Verification (v0.8.0)

After tool calls complete, Agent Guard checks whether the claimed effect matches reality:

| Tool | Check | What's verified |
|------|-------|----------------|
| `write` | `file_exists` | File exists and is not empty |
| `edit` | `content_match` | New text is present in the file |
| `exec` | `exit_code` | Command exited successfully |

If verification fails 3 consecutive times (configurable), subsequent tool calls are blocked — preventing cascading silent failures.

Custom verification rules can be added via config.

## Installation

```bash
openclaw plugins install --link /path/to/agent-guard-plugin
openclaw gateway restart
```

## Configuration

In `openclaw.config.yaml`:

```yaml
plugins:
  entries:
    agent-guard:
      config:
        enabled: true
        blockOnLoop: false          # Set true to block tool calls on loop detection
        loopThreshold: 3            # Repeats needed for action_loop detection
        loopWindowMs: 120000        # Time window for counting repeats (2 min)
        maxConsecutiveErrors: 3     # Consecutive errors for error_loop
        stateVerification: true     # Enable post-tool state checks (v0.8.0)
        verifyBlockThreshold: 3     # Consecutive verify failures before blocking
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
