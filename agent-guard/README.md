# Agent Guard 🛡️

Runtime loop detection and state verification for AI agents — an OpenClaw plugin.

## The Problem

AI agents get stuck. They repeat the same tool calls, loop on errors, or worse: claim success when nothing actually changed. "200 OK but nothing happened" is the silent failure that kills agent reliability.

## The Solution

Agent Guard hooks into OpenClaw's `before_tool_call` and `after_tool_call` events to:

1. **Detect loops** — action_loop (same tool+params), output_loop (same tool, different params), error_loop (consecutive failures)
2. **Verify state** — After write/edit/exec, check that files exist, content was applied, commands succeeded
3. **Block when needed** — Prevent tool execution on detected loops or consecutive verification failures

This runs **inside the agent runtime** — faster, more precise, and harder to bypass than external monitors.

## Quick Start

```bash
# Install the plugin
openclaw plugins install --link /path/to/agent-guard/plugin

# Restart gateway
openclaw gateway restart
```

Configure in `openclaw.config.yaml`:

```yaml
plugins:
  entries:
    agent-guard:
      config:
        enabled: true
        blockOnLoop: false        # Start with false, observe logs first
        loopThreshold: 3
        stateVerification: true   # v0.8.0: post-tool state checks
        logLevel: info
```

## Documentation

- **[Plugin README](plugin/README.md)** — Full installation, configuration, and architecture docs
- **[Agent Incidents 2026](blog/agent-incidents-2026.html)** — Research on real-world AI agent failure modes

## Validation

| Stage | Status |
|-------|--------|
| Plugin loaded | ✅ |
| Hooks fire on tool calls | ✅ |
| Loops detected | ✅ |
| Tool calls blocked | ✅ |
| State verification (v0.8.0) | ✅ |

## License

MIT
