# Show HN: Agent Guard – Runtime-internal loop detection and tool call blocking for AI agents

**Draft for human review — do not post without approval**

---

## Title options (HN max 80 chars)

1. Show HN: Agent Guard – Loop detection and tool-call blocking inside the agent runtime
2. Show HN: Agent Guard – Catch AI agent loops before the next tool call executes
3. Show HN: Agent Guard – The before_tool_call hook your AI agent is missing

## Post body

Hey HN,

We kept seeing the same failure mode in production AI agents: the task returns "success" but the agent was stuck in a loop the whole time. Cron jobs fire, tools execute, everything looks green — but the output is the same thing repeated 20 times, or the agent keeps retrying a failing API call until your bill explodes.

Existing guardrails (LlamaFirewall, Lakera, NeMo) focus on input/output safety — prompt injection, PII, content policy. Nobody was watching the runtime behavior layer: is the agent actually doing useful work, or just spinning?

Agent Guard is an OpenClaw plugin that hooks into `before_tool_call` and `after_tool_call` events inside the agent runtime. It detects three loop types:

- **action_loop**: same tool + same parameters repeated (agent is stuck)
- **output_loop**: same tool with different parameters but similar results (agent is "working" but producing nothing new)
- **error_loop**: consecutive tool call failures (agent keeps retrying a broken path)

When a loop is detected, it can optionally **block the next tool call before it executes** — not after, not from an external monitor, but from inside the runtime. This is the mechanism that could have prevented the Waxell $47k fintech incident (no way to terminate the session before the next API call completed).

Key design decisions:

1. **Runtime-internal, not network-layer**: External monitors (AgentOps, FutureAGI) observe from outside. Agent Guard runs as a platform hook — it can't be bypassed by the agent, and it adds near-zero latency since there's no network hop.

2. **Observe first, block later**: Start with `blockOnLoop=false` and review the `hook-proof.jsonl` logs. We learned the hard way that blocking too aggressively creates false positives (normal sequential `exec` calls trigger output_loop). The recommended workflow is 1-2 days of observation before enabling blocking.

3. **Self-governance protection**: The plugin includes a cooldown mechanism (`blockCooldownMs`) to prevent cascading blocks, and an over-governance check — if it blocks 3+ times in a row, it auto-downgrades to observe-only mode. A governance tool that locks the agent is worse than no governance tool.

4. **Proof logging**: Every hook event, loop detection, and block is logged to an append-only JSONL file. This is your audit trail for "what did the guardrail do and why."

We validated this on 961 real tool call records across 17 sessions. The main lesson: loop detection threshold of 2 gives ~41% false positive rate on normal work. Threshold of 6 for output_loop is the practical minimum. We published the analysis: https://jbilotta4-create.github.io/agent-guard/

The plugin currently works with OpenClaw. We're exploring framework-agnostic adapters (LangChain callbacks, CrewAI tools) if there's interest.

Repo: https://github.com/jbilotta4-create/agent-guard

What loop/behavior failure modes are you seeing in production agents? What would you want a runtime guardrail to catch?

---

## Notes for human

- This is a Show HN post — needs to feel authentic, not marketing-speak
- The "we" language assumes you're co-presenting; change to "I" if you prefer
- The Waxell incident reference is from public reports; verify before posting
- The 961 records / 41% FP stat is from our own analysis — defensible
- Ask: should we mention the 觅游 community posts? Probably not for HN audience
- Ask: should we include the five-layer model framing? Might be too much for HN — keep it focused on the tool
- Timing: HN Show HN posts do best on weekday mornings US time (8-10am ET = 8-10pm CST). Suggest posting tonight around 8pm your time
