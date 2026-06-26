# Why Your Agent's Loop Detector Is Missing Half the Problem

## The loop you can see vs. the loop you can't

Most loop detection in AI agents works the same way: watch for the same tool being called with the same parameters, over and over. OpenClaw calls it `genericRepeat`. LangChain calls it `LoopDetectionMiddleware`. The pattern is:

```
Tool: read_file("config.yaml") → same result
Tool: read_file("config.yaml") → same result  
Tool: read_file("config.yaml") → same result
→ LOOP DETECTED
```

This catches the obvious case. But there's a more dangerous pattern that slips right through:

```
Tool: search("fix nginx 502") → result A
Tool: search("nginx 502 error fix") → result B  
Tool: search("how to fix nginx bad gateway") → result C
Tool: search("nginx 502 troubleshooting") → result D
Tool: search("nginx upstream timeout solution") → result E
...
→ 50,000 calls in one hour. Production database goes down.
```

This is **output_loop**: same tool, different parameters every time. The agent is stuck, but each call looks "different" because the parameters change. Your loop detector sees 5 unique calls, not 1 loop.

## Real incident

From Reddit r/AI_Agents (2026):

> "One agent got stuck in a loop where it'd call an API, not like the response, call again with slightly different params, repeat forever. In one hour it made 50K requests to our database API and brought down production."

The agent wasn't repeating the exact same call. It was **exploring** — trying different parameters hoping for a different outcome. But the outcome was the same: no progress toward the actual goal.

## Why action_loop detection misses this

Action loop detection uses a triple match: `(tool_name, params_hash, result_hash)`. If any of these differ, it's not a loop.

In output_loop:
- `tool_name` is the same ✅
- `params_hash` is different ❌ (different search query each time)
- `result_hash` is different ❌ (different search results each time)

The detector sees: "5 different calls to search" — not a loop.

## The fix: track tool repetition, not just exact-call repetition

Agent Guard detects output_loop by tracking **how many times the same tool appears in a time window**, regardless of parameters. If `search` appears 6+ times in 2 minutes with different parameters each time, that's an output_loop.

This is a coarser signal — it has more false positives than exact-match detection. That's why we use tiered thresholds:
- 4-5 repetitions: **warn** (might be normal exploration)
- 6+ repetitions: **block** (likely a loop)

With 1,119 real tool calls logged, threshold=4 gives 29% detection rate with 0 false blocks. Not perfect, but it catches what action_loop detection completely misses.

## The three-loop model

| Loop type | Pattern | Detected by built-in? | Real frequency |
|-----------|---------|----------------------|----------------|
| action_loop | Same tool + same params + same result | ✅ genericRepeat | 29% of detections |
| output_loop | Same tool + different params | ❌ | ~10% of detections |
| error_loop | Consecutive failures | ❌ | ~2% of detections |

Action_loop is the most common but also the most benign — it's usually a stuck retry. Output_loop is rarer but more dangerous — it burns through API calls and can take down production. Error_loop is the most urgent — it means something is fundamentally broken.

## What this means for you

If you're using OpenClaw's built-in loop detection (`tools.loopDetection`), you're covered for action_loop. But you're blind to output_loop and error_loop.

Options:
1. Enable built-in detection + install Agent Guard for the gaps
2. Write your own output_loop detector (it's not hard — track tool frequency in a sliding window)
3. Accept the risk (output_loop is rare, but when it hits, it hits hard)

The code is open source: https://github.com/jbilotta4-create/agent-guard

---

*Based on 1,119 real tool-call logs from an OpenClaw agent running Agent Guard v0.6-v0.7, June 2026.*
