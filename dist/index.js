import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROOF_FILE = path.join(
  process.env.HOME || "/root",
  ".openclaw/workspace/agent-guard-plugin/hook-proof.jsonl",
);

function writeProof(record) {
  try {
    fs.appendFileSync(PROOF_FILE, JSON.stringify(record) + "\n");
  } catch {}
}

function hashParams(params) {
  try {
    // Only hash meaningful fields, skip noise like timeout/workdir
    const filtered = {};
    const meaningfulKeys = [
      "command", "path", "url", "query", "content", "action",
      "message", "sessionId", "channel", "selector", "text",
      "prompt", "image", "images",
    ];
    for (const k of meaningfulKeys) {
      if (params[k] !== undefined) filtered[k] = String(params[k]).slice(0, 200);
    }
    const sorted = JSON.stringify(filtered, Object.keys(filtered).sort());
    return crypto.createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

const actionHistory = new Map();
const loopAlertCooldown = new Map();
const consecutiveErrors = new Map();
const blockCooldown = new Map(); // Prevent cascading blocks
const consecutiveBlocks = new Map(); // Track consecutive blocks per session for "over-governance" detection
const MAX_CONSECUTIVE_BLOCKS = 3; // If we block 3 times in a row, auto-downgrade to detection-only mode

function recordAction(sessionId, toolName, params, isError) {
  const history = actionHistory.get(sessionId) || [];
  history.push({
    toolName,
    paramsHash: hashParams(params),
    isError,
    ts: Date.now(),
  });
  if (history.length > 100) history.splice(0, history.length - 100);
  actionHistory.set(sessionId, history);

  if (isError) {
    consecutiveErrors.set(sessionId, (consecutiveErrors.get(sessionId) || 0) + 1);
  } else {
    consecutiveErrors.set(sessionId, 0);
  }
}

function detectLoop(sessionId, windowMs, threshold, maxConsecutiveErrors) {
  const history = actionHistory.get(sessionId) || [];
  const now = Date.now();
  const recent = history.filter((a) => now - a.ts < windowMs);

  // Error loop
  const errors = consecutiveErrors.get(sessionId) || 0;
  if (errors >= maxConsecutiveErrors) {
    return {
      isLoop: true,
      loopType: "error_loop",
      repeatedActions: errors,
      severity: "high",
      confidence: 1.0,
    };
  }

  // Action loop: same tool + same meaningful params >= threshold
  // This catches "doing the exact same thing repeatedly"
  const toolParamCounts = {};
  for (const a of recent) {
    const key = `${a.toolName}:${a.paramsHash}`;
    toolParamCounts[key] = (toolParamCounts[key] || 0) + 1;
  }
  const maxTP = Object.entries(toolParamCounts).sort((a, b) => b[1] - a[1])[0];
  if (maxTP && maxTP[1] >= threshold) {
    return {
      isLoop: true,
      loopType: "action_loop",
      repeatedActions: maxTP[1],
      severity: maxTP[1] >= threshold * 2 ? "critical" : "high",
      confidence: 0.9,
    };
  }

  // Output loop: same tool name with DIFFERENT params >= high threshold
  // Use threshold * 2 for output_loop to avoid false positives
  // (exec/read/write being used 3-5 times in normal work is NOT a loop)
  const outputThreshold = Math.max(threshold * 2, 6);
  const toolNameCounts = {};
  for (const a of recent) {
    toolNameCounts[a.toolName] = (toolNameCounts[a.toolName] || 0) + 1;
  }
  const maxT = Object.entries(toolNameCounts).sort((a, b) => b[1] - a[1])[0];
  if (maxT && maxT[1] >= outputThreshold) {
    return {
      isLoop: true,
      loopType: "output_loop",
      repeatedActions: maxT[1],
      severity: "medium",
      confidence: 0.5,
    };
  }

  return { isLoop: false };
}

export default definePluginEntry({
  id: "agent-guard",
  name: "Agent Guard",
  version: "0.3.1",
  description:
    "Loop detection + over-governance auto-downgrade via plugin hooks (v0.3.1: added consecutive block limit to prevent governance tool self-locking)",
  register(api) {
    const getConfig = () => {
      const raw = api.pluginConfig || {};
      return {
        enabled: raw.enabled ?? true,
        loopWindowMs: raw.loopWindowMs ?? 120000,
        loopThreshold: raw.loopThreshold ?? 2,
        maxConsecutiveErrors: raw.maxConsecutiveErrors ?? 3,
        blockOnLoop: raw.blockOnLoop ?? false,
        blockCooldownMs: raw.blockCooldownMs ?? 60000, // 1 min cooldown between blocks
        logLevel: raw.logLevel ?? "info",
      };
    };

    // after_tool_call: Record + detect
    api.on(
      "after_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";
        const toolName = event.toolName || "unknown";
        const params = event.params || {};
        const isError = Boolean(event.error);

        recordAction(sessionId, toolName, params, isError);

        writeProof({
          hook: "after_tool_call",
          ts: new Date().toISOString(),
          sessionId,
          toolName,
          isError,
          paramsHash: hashParams(params),
        });

        const result = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (result.isLoop) {
          const now = Date.now();
          const lastAlert = loopAlertCooldown.get(sessionId) || 0;
          if (now - lastAlert > 300000) {
            api.logger.warn?.(
              `Agent Guard: LOOP [${result.loopType}] session=${sessionId} tool=${toolName} repeats=${result.repeatedActions} severity=${result.severity}`,
            );
            loopAlertCooldown.set(sessionId, now);
          }
          writeProof({
            hook: "loop_detected",
            ts: new Date().toISOString(),
            sessionId,
            toolName,
            loopType: result.loopType,
            repeats: result.repeatedActions,
            severity: result.severity,
            confidence: result.confidence,
          });
        }
      },
      { priority: 80 },
    );

    // before_tool_call: Block only on action_loop (exact same action repeated)
    // Do NOT block on output_loop (same tool different params) — too many false positives
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;
        if (!config.blockOnLoop) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";
        const toolName = event.toolName || "unknown";
        const params = event.params || {};

        // Check block cooldown — if we recently blocked, don't block again immediately
        // This prevents cascading blocks (the "governance tool locks itself" problem)
        const now = Date.now();
        const lastBlock = blockCooldown.get(sessionId) || 0;
        if (now - lastBlock < config.blockCooldownMs) {
          writeProof({
            hook: "before_tool_call_skipped_cooldown",
            ts: new Date().toISOString(),
            sessionId,
            toolName,
          });
          return; // Skip blocking during cooldown
        }

        // Pre-record to count this call
        recordAction(sessionId, toolName, params, false);

        const result = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        // Only block on action_loop and error_loop — NOT output_loop
        // Output loop (exec used 6 times) is normal agent work
        const shouldBlock =
          result.isLoop &&
          (result.loopType === "action_loop" || result.loopType === "error_loop");

        // Undo pre-record if not blocking
        if (!shouldBlock) {
          const history = actionHistory.get(sessionId) || [];
          if (history.length > 0) history.pop();
          actionHistory.set(sessionId, history);
          // Reset consecutive blocks counter — normal tool call means governance is working correctly
          consecutiveBlocks.set(sessionId, 0);
        }

        if (shouldBlock) {
          blockCooldown.set(sessionId, now); // Set cooldown to prevent cascading
          
          // Over-governance detection: if we've blocked 3+ times consecutively, downgrade to detection-only
          const blockCount = (consecutiveBlocks.get(sessionId) || 0) + 1;
          consecutiveBlocks.set(sessionId, blockCount);
          
          if (blockCount >= MAX_CONSECUTIVE_BLOCKS) {
            // Too many consecutive blocks — likely over-governance (failure #6 pattern)
            // Downgrade: don't actually block, just log a warning
            consecutiveBlocks.set(sessionId, 0); // Reset counter after downgrade
            writeProof({
              hook: "before_tool_call_overgovernance_downgrade",
              ts: new Date().toISOString(),
              sessionId,
              toolName,
              consecutiveBlocks: blockCount,
              message: "Too many consecutive blocks detected — auto-downgraded to detection-only mode. Governance tool itself may be misconfigured.",
            });
            api.logger.warn?.(
              `Agent Guard: OVER-GOVERNANCE detected — ${blockCount} consecutive blocks. Auto-downgraded to detection-only. Governance tool may need recalibration.`,
            );
            // Don't block — let the tool call proceed
            // Undo the pre-record since we're not blocking
            const history = actionHistory.get(sessionId) || [];
            if (history.length > 0) history.pop();
            actionHistory.set(sessionId, history);
            return; // Allow the call to proceed
          }
          
          writeProof({
            hook: "before_tool_call_blocked",
            ts: new Date().toISOString(),
            sessionId,
            toolName,
            loopType: result.loopType,
            repeats: result.repeatedActions,
            severity: result.severity,
            consecutiveBlocks: blockCount,
          });
          return {
            block: true,
            blockReason: `Agent Guard: Loop detected (${result.loopType}, ${result.repeatedActions} repeats, severity=${result.severity}). Tool call blocked to prevent waste.`,
          };
        }
      },
      { priority: 90 },
    );
  },
});
