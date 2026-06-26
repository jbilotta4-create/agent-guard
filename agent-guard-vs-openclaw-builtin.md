# Agent Guard vs OpenClaw Built-in Loop Detection

## OpenClaw Built-in (from docs/tools/loop-detection.md)

### What it does
1. **Loop detection** (`tools.loopDetection.enabled`, default: **false**)
   - Rolling history of 30 tool calls
   - 3 detectors: genericRepeat, knownPollNoProgress, pingPong
   - Warning at 10 repeats, critical at 20, circuit breaker at 30
   - **Disabled by default** — user must explicitly enable

2. **Post-compaction guard** (default: **enabled**)
   - Arms after compaction-retry
   - Watches next 3 tool calls for identical (tool, args, result) triples
   - Aborts if same triple repeats → `compaction_loop_persisted`
   - Only fires in immediate aftermath of compaction

### Key characteristics
- **High thresholds**: warning=10, critical=20, circuit breaker=30
- **Disabled by default**: rolling-history detectors are OFF unless user enables
- **Post-compaction guard is ON by default** but only covers compaction scenario
- **No error_loop detection**: doesn't specifically track consecutive errors across tools
- **No output_loop detection**: genericRepeat checks same tool+same params, not same tool+different params
- **No state verification**: doesn't check if tool results match reality
- **No recovery suggestions**: blocks but doesn't tell agent what to try instead
- **No cross-tool error cascade**: doesn't distinguish single-tool vs multi-tool failure patterns

## Agent Guard Plugin

### What it does
1. **Loop detection** (always on when plugin installed)
   - 4 loop types: action_loop, output_loop, error_loop, error_cascade
   - Lower thresholds: default threshold=3, block at threshold+2=5
   - Result nontriviality filtering (v0.9.0) — reduces output_loop false positives
   - Cross-tool error cascade detection (v0.9.1) — distinguishes pivot failures from single-tool loops

2. **State verification** (Layer 3-4)
   - file_exists, content_match, exit_code, url_accessible, result_nontrivial checks
   - Catches "200 OK but nothing happened" (silent no-ops)
   - Blocks after 3 consecutive verification failures

3. **Recovery suggestions** (v0.9.1)
   - Each loop type has a specific hint in blockReason
   - error_cascade → "check environment/permissions"
   - error_loop → "check error, try different strategy"

### Key characteristics
- **Always on** when plugin is installed — no config needed
- **Lower thresholds** — catches loops earlier (3-5 vs 10-20)
- **output_loop detection** — OpenClaw doesn't have this
- **error_loop + error_cascade** — OpenClaw doesn't distinguish these
- **State verification** — OpenClaw doesn't verify post-execution state
- **Recovery suggestions** — OpenClaw blocks but doesn't advise

## The Real Differentiation

| Feature | OpenClaw Built-in | Agent Guard |
|---------|------------------|-------------|
| Default state | OFF (rolling), ON (post-compaction only) | ON (all detectors) |
| Detection speed | 10-20 repeats before action | 3-5 repeats |
| action_loop | ✅ genericRepeat | ✅ |
| output_loop | ❌ | ✅ (with result filtering) |
| error_loop | ❌ | ✅ |
| error_cascade | ❌ | ✅ (v0.9.1) |
| pingPong | ✅ | ❌ (not yet) |
| Post-compaction guard | ✅ (built-in, excellent) | ❌ (plugin can't hook compaction) |
| State verification | ❌ | ✅ (5 check types) |
| Recovery suggestions | ❌ | ✅ (v0.9.1) |
| Config complexity | 8+ fields | 6 fields, sensible defaults |

## Strategic Implications

1. **Agent Guard is NOT redundant** — it covers 3 loop types OpenClaw doesn't (output_loop, error_loop, error_cascade) plus state verification
2. **Agent Guard is complementary** — OpenClaw's post-compaction guard is excellent and plugin-level code can't replicate it
3. **The gap is real**: OpenClaw's built-in is designed for "obvious, long-running loops" (10-20 repeats). Agent Guard catches "subtle, early loops" (3-5 repeats) that still waste tokens but don't trigger built-in detection
4. **Missing from Agent Guard**: pingPong detection (OpenClaw has it, we don't yet)

## Action Items
- [ ] Add pingPong detection to Agent Guard (OpenClaw has it, we should too)
- [ ] Document the complementary relationship clearly in README
- [ ] Consider: should Agent Guard's thresholds be configurable to avoid conflicting with OpenClaw's built-in?
