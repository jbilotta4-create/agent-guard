# Agent Guard — Real User Pain Points

Sourced from OpenClaw GitHub issues. These are the real scenarios Agent Guard should handle.

## Issue #76938 — Context compaction causes agent to loop after truncation
- **What happens**: Long session → compaction truncates → agent loses context → starts looping / repeating same response
- **Agent Guard relevance**: This is `output_loop` + `ping_pong` in production. After compaction, agent repeats because it lost the context that would tell it "you already did this."
- **Current coverage**: output_loop detection exists, but may not trigger if params differ slightly
- **Gap**: Need to detect "same semantic intent, different literal params" — current hash-based detection misses this

## Issue #71273 — Kimi Code model enters infinite tool call loop
- **What happens**: Model repeatedly calls same tools with identical parameters instead of generating final answer
- **Agent Guard relevance**: This is textbook `action_loop` — same tool + same params. Should be caught immediately.
- **Current coverage**: action_loop with threshold 2 should catch this
- **Gap**: Why doesn't OpenClaw's built-in loop detection catch this? Need to investigate if it's a model-specific issue or a detection gap

## Issue #91307 — Feishu DM session enters infinite loop after subagent announce
- **What happens**: Subagent announce triggers new DIRECT runs without user input, creating infinite loop
- **Agent Guard relevance**: This is a different kind of loop — not tool-call loop, but session/event loop. Agent Guard's tool-level hooks may not catch this.
- **Current coverage**: None — Agent Guard only hooks into tool calls, not session events
- **Gap**: Session-level loops are outside current scope. Could be future direction.

## Issue #95288 — Telegram/WhatsApp recovery starves event loop → restart loop
- **What happens**: Channel recovery timeout → event loop starvation → supervisor restart → restart loop
- **Agent Guard relevance**: Infrastructure-level loop, not agent behavior loop. Outside scope.
- **Current coverage**: None

## Issue #76275 — Gateway restarting loop after upgrade
- **What happens**: Gateway enters crash-restart cycle
- **Agent Guard relevance**: Infrastructure-level. Outside scope.

## Additional Issues from GitHub Search

### Issue #87310 — Stale blocked_tool_call survives session recovery
- **What**: After stuck-session recovery/reset, stale diagnostic activity can persist and cause future work on the same sessionKey to be classified as `blocked_tool_call`
- **Agent Guard relevance**: If Agent Guard's blockOnLoop sets a block signal, and the session is then recovered/reset, the block signal might persist incorrectly. This is the same class of problem as our self-lock incident.
- **Mitigation**: Agent Guard's block signals use timestamps with 5-min expiry. But if the session is recovered and the timestamp is still within 5 min, the block could persist.
- **Action**: Add session-reset detection to clear block signals.

### Issue #80040 — Cascading failure: OAuth invalidation → empty reply → duplicate tool execution → context loss
- **What**: Multi-stage cascading failure triggered by OAuth invalidation
- **Agent Guard relevance**: This is a real-world error_cascade scenario. Different tools fail for different reasons, but the root cause is the same (invalidated OAuth).
- **Current coverage**: error_cascade detection would catch the symptom (multiple tools failing) but not the root cause (OAuth). Recovery suggestion should mention "check authentication/credentials".

### Issue #91285 — OpenClaw Tool Lifecycle / Gateway Recovery Field Report
- **What**: Comprehensive field report on tool lifecycle failures and gateway recovery
- **Agent Guard relevance**: Worth reading in detail for understanding the full failure landscape

### Issue #75923 — Cross-tool consecutive error cascade detection
- **What**: Agent pivots across different tools, each one fails, creating an error cascade
- **Label**: P2, stale, impact:session-state
- **Agent Guard relevance**: This is `error_loop` at the cross-tool level. Current error_loop only counts consecutive errors for the SAME tool. This issue asks for cross-tool error cascade detection.
- **Gap**: Agent Guard currently tracks consecutive errors per session, not per run. Cross-tool cascades would need a different counting approach.

### Issue #37842 — Triangular/polygonal loop in multi-agent sessions_send
- **What**: In 17-agent deployment, messages cycle through 3+ agents (A→B→C→A), bypassing maxPingPongTurns
- **Impact**: Overnight echo storm with 9 agents exchanging messages
- **Agent Guard relevance**: Multi-agent loop detection. Current Agent Guard is single-agent scope.
- **Gap**: This is a different domain (inter-agent loops vs intra-agent loops). Could be v2.0 direction.

### Issue #45049 — Agent simulates tool calls instead of invoking them
- **What**: Model outputs tool-call-like text instead of actually calling the tool
- **Labels**: P1, security, session-state, message-loss
- **Agent Guard relevance**: This is a "silent no-op" variant — the agent claims it did something but didn't actually invoke the tool
- **Current coverage**: result_nontrivial check catches this if the result is empty. But this is about the call not happening at all, not the result being empty.
- **Gap**: before_tool_call hooks can't detect "should have been a tool call but was text". This would need a different detection mechanism.

### Issue #85914 — Tool failure recovery as native capability
- **What**: When tool fails, agent should get one bounded continuation step with failure in context
- **Agent Guard relevance**: This is about recovery, not detection. Agent Guard detects loops but doesn't help the agent recover.
- **Potential**: Agent Guard could add a "recovery suggestion" in the blockReason — not just "you're looping" but "try this instead".

## Summary: Agent Guard's Ability Boundary (Clarified)

**CAN solve (current scope)**:
- action_loop (same tool + same params) → ✅ #71273
- output_loop with meaningful output filter → ✅ v0.9.0 fix
- error_loop (consecutive errors) → ✅ but only single-tool scope
- silent no-op (empty result) → ✅ result_nontrivial

**CANNOT solve (current scope)**:
- Cross-tool error cascades → #75923 (needs cross-tool tracking)
- Multi-agent triangular loops → #37842 (needs inter-agent scope)
- Simulated tool calls → #45049 (needs output parsing, not hook)
- Infrastructure restart loops → #95288, #76275 (not agent behavior)
- Session-level infinite loops → #91307 (not tool-call level)

**Could solve (future direction)**:
- Cross-tool error cascade → extend error_loop to cross-tool scope
- Recovery suggestions → add actionable advice in blockReason
- Multi-agent loop → v2.0 with inter-agent detection

The issues that Agent Guard CAN solve are #76938 and #71273 — agent behavior loops at the tool-call level. 

The issues it CANNOT solve are #95288, #76275, #91307 — infrastructure/session-level loops.

**This clarifies the ability boundary**: Agent Guard = agent behavior loops. Not infrastructure loops, not session loops.

## Current Known Issues (from hook-proof.jsonl analysis)

### Issue 1: exec output_loop false positive rate is very high
- **Data**: 194 exec output_loop detections across 39 sessions, but most are normal sequential shell commands
- **Root cause**: exec is the most commonly used tool. Running 6+ exec calls in sequence (e.g., git status, git diff, git add, git commit, git push) triggers output_loop because it's same tool name with different params
- **Impact**: Users who run with blockOnLoop=true would get blocked during normal work
- **Current mitigation**: output_loop doesn't block (only action_loop and error_loop block). But the warnings are noisy.
- **Proposed fix**: 
  - Option A: Increase output_loop threshold for exec specifically (e.g., 10 instead of 6)
  - Option B: Add "tool whitelist" — exclude exec from output_loop detection by default
  - Option C: Smarter detection — check if exec results are producing meaningful output (result_nontrivial) vs. producing errors/repeated output
  - **Best option**: C, because it aligns with the result_nontrivial check already in v0.8.1

### Issue 2: No detection for semantic repetition (same intent, different params)
- **Data**: OpenClaw issue #76938 — agent loops after context compaction, repeating same semantic action but with slightly different params
- **Current coverage**: Hash-based detection misses this because params differ literally
- **Proposed fix**: Add semantic similarity check for output (compare last N tool call results, not just params)

### Issue 3: Only 4 blocks in 2500 records — blockOnLoop is rarely triggered
- **Data**: All 4 blocks were from the self-lock incident (session bd4146cd)
- **Implication**: In observe-only mode (blockOnLoop=false), Agent Guard is collecting data but not protecting. Users need to manually review and enable blocking.
- **Action**: Improve the onboarding flow — provide a "review your hook-proof data" command that summarizes detected loops and recommends whether to enable blocking

## Action Items

1. Test: Can Agent Guard v0.8.1 catch the #71273 scenario (identical tool calls)?
2. Test: Does output_loop detection catch #76938 (repeated responses after compaction)?
3. Investigate: Why doesn't OpenClaw's built-in detection catch these already?
4. Consider: Should Agent Guard also hook into session-level events (not just tool calls)?
