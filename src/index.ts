/**
 * Agent Guard — OpenClaw Plugin
 * 
 * Automatic loop detection and governance via plugin hooks.
 * No voluntary tool calls needed — runs on every tool call automatically.
 * 
 * Hook strategy:
 * - after_tool_call: record action + detect loops (observation)
 * - before_tool_call: block tool calls when loop detected (decision, if blockOnLoop=true)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// --- Loop Detection Engine (pure logic, no external deps) ---

interface ActionRecord {
  toolName: string;
  paramsHash: string;
  timestamp: number;
  isError: boolean;
  sessionId: string;
}

interface LoopDetectionResult {
  isLoop: boolean;
  loopType: "action_loop" | "output_loop" | "error_loop" | "ping_pong" | "none";
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  repeatedActions: number;
  windowMs: number;
  shouldStop: boolean;
}

// In-memory action history per session
const actionHistory: Map<string, ActionRecord[]> = new Map();
const consecutiveErrors: Map<string, number> = new Map();
const loopAlertCooldown: Map<string, number> = new Map();

function hashParams(params: Record<string, unknown>): string {
  // Simple deterministic hash — order keys, stringify values
  const keys = Object.keys(params).sort();
  const parts = keys.map(k => {
    const v = params[k];
    if (v === null || v === undefined) return `${k}:null`;
    if (typeof v === "string") return `${k}:${v}`;
    if (typeof v === "number") return `${k}:${v}`;
    if (typeof v === "boolean") return `${k}:${v}`;
    if (Array.isArray(v)) return `${k}:arr${v.length}`;
    if (typeof v === "object") return `${k}:obj`;
    return `${k}:unknown`;
  });
  return parts.join("|");
}

function detectLoop(
  sessionId: string,
  loopWindowMs: number,
  loopThreshold: number,
  maxConsecutiveErrors: number,
): LoopDetectionResult {
  const now = Date.now();
  const history = actionHistory.get(sessionId) || [];
  const windowActions = history.filter(a => now - a.timestamp < loopWindowMs);

  // Check error loop first (most urgent)
  const errorCount = consecutiveErrors.get(sessionId) || 0;
  if (errorCount >= maxConsecutiveErrors) {
    return {
      isLoop: true,
      loopType: "error_loop",
      confidence: Math.min(1.0, errorCount / (maxConsecutiveErrors * 2)),
      severity: errorCount >= maxConsecutiveErrors * 2 ? "critical" : "high",
      repeatedActions: errorCount,
      windowMs: loopWindowMs,
      shouldStop: true,
    };
  }

  // Check action loop — same tool+params repeated
  const actionCounts: Map<string, number> = new Map();
  for (const a of windowActions) {
    const key = `${a.toolName}:${a.paramsHash}`;
    actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
  }

  let maxRepeat = 0;
  let repeatedKey = "";
  for (const [key, count] of actionCounts) {
    if (count > maxRepeat) {
      maxRepeat = count;
      repeatedKey = key;
    }
  }

  if (maxRepeat >= loopThreshold) {
    // Tiered detection: warn at threshold, block at blockThreshold
    // With default threshold=4, blockThreshold=6:
    //   repeats 4-5 = warn only (likely normal work)
    //   repeats ≥6 = shouldStop (likely real loop)
    const blockThreshold = loopThreshold + 2; // Always 2 above detection threshold
    const isBlockable = maxRepeat >= blockThreshold;
    return {
      isLoop: true,
      loopType: "action_loop",
      confidence: Math.min(1.0, maxRepeat / blockThreshold),
      severity: maxRepeat >= blockThreshold * 1.5 ? "critical" : isBlockable ? "high" : "medium",
      repeatedActions: maxRepeat,
      windowMs: loopWindowMs,
      shouldStop: isBlockable,
    };
  }

  // Check ping-pong loop — alternating between two tools (A→B→A→B)
  if (windowActions.length >= 4) {
    const recentTools = windowActions.slice(-6).map(a => a.toolName);
    let isPingPong = true;
    if (recentTools.length >= 4) {
      for (let i = 2; i < recentTools.length; i++) {
        if (recentTools[i] !== recentTools[i - 2]) {
          isPingPong = false;
          break;
        }
      }
      // Must be alternating between two DIFFERENT tools
      if (isPingPong && recentTools[0] === recentTools[1]) {
        isPingPong = false;
      }
    } else {
      isPingPong = false;
    }

    if (isPingPong) {
      // Count how many full A→B cycles
      const cycleCount = Math.floor(recentTools.length / 2);
      const blockThreshold = loopThreshold + 2;
      const isBlockable = cycleCount >= blockThreshold;
      return {
        isLoop: true,
        loopType: "ping_pong",
        confidence: Math.min(0.9, cycleCount / blockThreshold),
        severity: isBlockable ? "high" : "medium",
        repeatedActions: cycleCount,
        windowMs: loopWindowMs,
        shouldStop: isBlockable,
      };
    }
  }

  // Check output loop — same tool called repeatedly with DIFFERENT params
  const toolCounts: Map<string, number> = new Map();
  for (const a of windowActions) {
    toolCounts.set(a.toolName, (toolCounts.get(a.toolName) || 0) + 1);
  }

  let maxToolRepeat = 0;
  let repeatedTool = "";
  let paramVariants = 0;
  for (const [tool, count] of toolCounts) {
    if (count > maxToolRepeat) {
      maxToolRepeat = count;
      repeatedTool = tool;
      // Count unique param variants for this tool
      paramVariants = windowActions.filter(a => a.toolName === tool).length;
    }
  }

  if (maxToolRepeat >= loopThreshold && paramVariants > 1) {
    // Same tiered logic for output_loop
    const blockThreshold = loopThreshold + 2;
    const isBlockable = maxToolRepeat >= blockThreshold;
    return {
      isLoop: true,
      loopType: "output_loop",
      confidence: Math.min(0.8, maxToolRepeat / blockThreshold),
      severity: isBlockable ? "high" : "medium",
      repeatedActions: maxToolRepeat,
      windowMs: loopWindowMs,
      shouldStop: isBlockable,
    };
  }

  return {
    isLoop: false,
    loopType: "none",
    confidence: 0,
    severity: "low",
    repeatedActions: maxRepeat,
    windowMs: loopWindowMs,
    shouldStop: false,
  };
}

function recordAction(
  sessionId: string,
  toolName: string,
  params: Record<string, unknown>,
  isError: boolean,
): void {
  const now = Date.now();
  const record: ActionRecord = {
    toolName,
    paramsHash: hashParams(params),
    timestamp: now,
    isError,
    sessionId,
  };

  const history = actionHistory.get(sessionId) || [];
  history.push(record);
  // Keep last 100 actions per session
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }
  actionHistory.set(sessionId, history);

  // Track consecutive errors
  if (isError) {
    consecutiveErrors.set(sessionId, (consecutiveErrors.get(sessionId) || 0) + 1);
  } else {
    consecutiveErrors.set(sessionId, 0);
  }
}

// --- Plugin Entry Point ---

export default definePluginEntry({
  id: "agent-guard",
  name: "Agent Guard",
  description: "Automatic loop detection and governance via plugin hooks",

  register(api) {
    // Resolve config (with defaults)
    const getConfig = () => {
      const raw: Record<string, unknown> = (api as Record<string, unknown>).config as Record<string, unknown> ?? {};
      return {
        enabled: (raw.enabled as boolean) ?? true,
        loopWindowMs: (raw.loopWindowMs as number) ?? 120000,
        loopThreshold: (raw.loopThreshold as number) ?? 3,
        maxConsecutiveErrors: (raw.maxConsecutiveErrors as number) ?? 3,
        blockOnLoop: (raw.blockOnLoop as boolean) ?? false,
        logLevel: (raw.logLevel as string) ?? "info",
      };
    };

    // === after_tool_call: Record action + detect loop ===
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

        const result = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (result.isLoop) {
          // Cooldown: don't spam alerts (5 min between same-session alerts)
          const now = Date.now();
          const lastAlert = loopAlertCooldown.get(sessionId) || 0;
          if (now - lastAlert > 300000) {
            api.logger.warn?.(
              `Agent Guard: LOOP DETECTED [${result.loopType}] session=${sessionId} tool=${toolName} repeats=${result.repeatedActions} severity=${result.severity} confidence=${result.confidence.toFixed(2)} shouldStop=${result.shouldStop}`,
            );
            loopAlertCooldown.set(sessionId, now);
          }
        }
      },
      { priority: 80 },
    );

    // === before_tool_call: Block tool calls when loop is detected ===
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;
        if (!config.blockOnLoop) return; // Only block if configured

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";

        const result = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (result.isLoop && result.shouldStop) {
          api.logger.warn?.(
            `Agent Guard: BLOCKING tool call [${event.toolName}] — loop detected (${result.loopType}, repeats=${result.repeatedActions}, severity=${result.severity})`,
          );

          return {
            block: true,
            blockReason: `Agent Guard: Loop detected (${result.loopType}, ${result.repeatedActions} repeats in ${result.windowMs}ms window, severity=${result.severity}). Stopping to prevent resource waste.`,
          };
        }
      },
      { priority: 90 }, // Higher priority = runs first, can block before other hooks
    );
  },
});
