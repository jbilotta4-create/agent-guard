/**
 * Agent Guard — OpenClaw Plugin
 * 
 * Automatic loop detection and state verification via plugin hooks.
 * No voluntary tool calls needed — runs on every tool call automatically.
 * 
 * Hook strategy:
 * - after_tool_call: record action + detect loops + verify state (observation + verification)
 * - before_tool_call: block tool calls when loop detected or state verification failed (decision)
 * 
 * v0.8.0: Added Layer 3-4 state verification (Tool-Use Reliability Stack)
 */

// @ts-ignore - OpenClaw plugin SDK is runtime-provided
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as fs from "fs";
import * as path from "path";

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
  loopType: "action_loop" | "output_loop" | "error_loop" | "none";
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
    return {
      isLoop: true,
      loopType: "action_loop",
      confidence: Math.min(1.0, maxRepeat / (loopThreshold * 2)),
      severity: maxRepeat >= loopThreshold * 3 ? "critical" : maxRepeat >= loopThreshold * 2 ? "high" : "medium",
      repeatedActions: maxRepeat,
      windowMs: loopWindowMs,
      shouldStop: maxRepeat >= loopThreshold * 2,
    };
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
    return {
      isLoop: true,
      loopType: "output_loop",
      confidence: Math.min(0.8, maxToolRepeat / (loopThreshold * 2)),
      severity: maxToolRepeat >= loopThreshold * 2 ? "high" : "medium",
      repeatedActions: maxToolRepeat,
      windowMs: loopWindowMs,
      shouldStop: maxToolRepeat >= loopThreshold * 2,
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

// --- State Verification Engine (Layer 3-4 of Tool-Use Reliability Stack) ---
//
// After a tool call completes, verify that the agent's claimed effect matches reality.
// This addresses the "200 OK but nothing happened" failure mode.
//
// Layer 3 (Semantic): Did the agent call the right tool with the right params?
// Layer 4 (State): Did the tool call actually change the system state as expected?

interface VerificationRule {
  toolName: string | string[];    // Tool(s) to match
  checkType: "file_exists" | "content_match" | "exit_code" | "custom";
  paramPath: string;             // Dot-path to extract verification target from params
  severity: "warn" | "block";    // What to do on verification failure
  description?: string;          // Human-readable description of what this rule verifies
}

interface VerificationResult {
  passed: boolean;
  rule: VerificationRule;
  detail: string;                // What was checked and what was found
  actualState?: string;          // The actual state observed
}

// Default verification rules for OpenClaw built-in tools
const DEFAULT_RULES: VerificationRule[] = [
  // write tool: verify file exists after writing
  {
    toolName: "write",
    checkType: "file_exists",
    paramPath: "path",
    severity: "warn",
    description: "Verify file exists after write",
  },
  // edit tool: verify the edited file still exists and contains the new text
  {
    toolName: "edit",
    checkType: "content_match",
    paramPath: "path",
    severity: "warn",
    description: "Verify edit was applied to file",
  },
  // exec tool: verify exit code
  {
    toolName: "exec",
    checkType: "exit_code",
    paramPath: "command",
    severity: "warn",
    description: "Verify command exited successfully",
  },
];

// Track consecutive verification failures per session
const verifyFailures: Map<string, number> = new Map();
const VERIFY_FAILURE_THRESHOLD = 3; // Block after 3 consecutive failures

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const keys = dotPath.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function matchesRule(toolName: string, rule: VerificationRule): boolean {
  if (Array.isArray(rule.toolName)) {
    return rule.toolName.includes(toolName);
  }
  return rule.toolName === toolName;
}

function verifyState(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  isError: boolean,
  rule: VerificationRule,
): VerificationResult {
  const targetPath = getNestedValue(params, rule.paramPath) as string | undefined;

  switch (rule.checkType) {
    case "file_exists": {
      if (!targetPath) {
        return { passed: true, rule, detail: `No path found at ${rule.paramPath}, skipping` };
      }
      try {
        const exists = fs.existsSync(targetPath);
        if (!exists) {
          return {
            passed: false,
            rule,
            detail: `File should exist after ${toolName} but not found: ${targetPath}`,
            actualState: "file_not_found",
          };
        }
        // Also check file is not empty (for write operations)
        if (toolName === "write") {
          const stat = fs.statSync(targetPath);
          if (stat.size === 0) {
            return {
              passed: false,
              rule,
              detail: `File exists but is empty after write: ${targetPath}`,
              actualState: "file_empty",
            };
          }
        }
        return { passed: true, rule, detail: `File verified: ${targetPath}` };
      } catch (err) {
        return {
          passed: false,
          rule,
          detail: `Error checking file ${targetPath}: ${(err as Error).message}`,
          actualState: "check_error",
        };
      }
    }

    case "content_match": {
      if (!targetPath) {
        return { passed: true, rule, detail: `No path found at ${rule.paramPath}, skipping` };
      }
      try {
        if (!fs.existsSync(targetPath)) {
          return {
            passed: false,
            rule,
            detail: `File not found for content verification: ${targetPath}`,
            actualState: "file_not_found",
          };
        }
        // For edit tool: check if any of the newText values exist in the file
        if (toolName === "edit") {
          const edits = params.edits as Array<{ newText: string }> | undefined;
          if (edits && Array.isArray(edits)) {
            const content = fs.readFileSync(targetPath, "utf-8");
            const missingEdits = edits.filter(e => !content.includes(e.newText));
            if (missingEdits.length > 0) {
              return {
                passed: false,
                rule,
                detail: `${missingEdits.length} edit(s) not found in file after edit: ${targetPath}`,
                actualState: "content_mismatch",
              };
            }
          }
        }
        return { passed: true, rule, detail: `Content verified: ${targetPath}` };
      } catch (err) {
        return {
          passed: false,
          rule,
          detail: `Error checking content of ${targetPath}: ${(err as Error).message}`,
          actualState: "check_error",
        };
      }
    }

    case "exit_code": {
      if (isError) {
        return {
          passed: false,
          rule,
          detail: `Command failed with error: ${targetPath}`,
          actualState: "nonzero_exit",
        };
      }
      // For exec, if no error was reported, we trust the exit code was 0
      // In a full implementation, we'd parse the actual exit code from the result
      return { passed: true, rule, detail: `Command exited successfully: ${targetPath}` };
    }

    case "custom": {
      // Placeholder for user-defined verification logic
      return { passed: true, rule, detail: "Custom verification not implemented yet" };
    }

    default:
      return { passed: true, rule, detail: `Unknown check type: ${rule.checkType}` };
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
      const raw = api.getConfig?.() ?? {};
      return {
        enabled: raw.enabled ?? true,
        loopWindowMs: raw.loopWindowMs ?? 120000,
        loopThreshold: raw.loopThreshold ?? 3,
        maxConsecutiveErrors: raw.maxConsecutiveErrors ?? 3,
        blockOnLoop: raw.blockOnLoop ?? false,
        stateVerification: raw.stateVerification ?? true,  // Enable Layer 3-4 verification
        verificationRules: raw.verificationRules ?? undefined, // Custom rules override
        verifyBlockThreshold: raw.verifyBlockThreshold ?? VERIFY_FAILURE_THRESHOLD,
        logLevel: raw.logLevel ?? "info",
      };
    };

    // === after_tool_call: Record action + detect loop + verify state ===
    api.on(
      "after_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";
        const toolName = event.toolName || "unknown";
        const params = event.params || {};
        const isError = Boolean(event.error);
        const result = event.result;

        // --- Loop Detection (existing) ---
        recordAction(sessionId, toolName, params, isError);

        const loopResult = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (loopResult.isLoop) {
          // Cooldown: don't spam alerts (5 min between same-session alerts)
          const now = Date.now();
          const lastAlert = loopAlertCooldown.get(sessionId) || 0;
          if (now - lastAlert > 300000) {
            api.logger.warn?.(
              `Agent Guard: LOOP DETECTED [${loopResult.loopType}] session=${sessionId} tool=${toolName} repeats=${loopResult.repeatedActions} severity=${loopResult.severity} confidence=${loopResult.confidence.toFixed(2)} shouldStop=${loopResult.shouldStop}`,
            );
            loopAlertCooldown.set(sessionId, now);
          }
        }

        // --- State Verification (Layer 3-4, new in v0.8.0) ---
        if (config.stateVerification) {
          const rules = config.verificationRules || DEFAULT_RULES;
          const matchingRules = rules.filter((r: VerificationRule) => matchesRule(toolName, r));

          for (const rule of matchingRules) {
            const verifyResult = verifyState(toolName, params, result, isError, rule);

            if (!verifyResult.passed) {
              // Track consecutive failures
              const failCount = (verifyFailures.get(sessionId) || 0) + 1;
              verifyFailures.set(sessionId, failCount);

              const shouldBlock = rule.severity === "block" || failCount >= config.verifyBlockThreshold;

              api.logger[shouldBlock ? "error" : "warn"]?.(
                `Agent Guard: STATE VERIFICATION FAILED [${rule.checkType}] tool=${toolName} severity=${rule.severity} consecutive_failures=${failCount} detail=${verifyResult.detail}`,
              );

              if (shouldBlock) {
                // Store block signal for before_tool_call to pick up
                loopAlertCooldown.set(`${sessionId}:verify_block`, Date.now());
              }
            } else {
              // Reset consecutive failure count on success
              verifyFailures.set(sessionId, 0);

              if (config.logLevel === "debug") {
                api.logger.info?.(
                  `Agent Guard: State verification passed [${rule.checkType}] tool=${toolName} detail=${verifyResult.detail}`,
                );
              }
            }
          }
        }
      },
      { priority: 80 },
    );

    // === before_tool_call: Block tool calls when loop detected or state verification failed ===
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";

        // Check 1: Loop detection block
        if (config.blockOnLoop) {
          const loopResult = detectLoop(
            sessionId,
            config.loopWindowMs,
            config.loopThreshold,
            config.maxConsecutiveErrors,
          );

          if (loopResult.isLoop && loopResult.shouldStop) {
            api.logger.warn?.(
              `Agent Guard: BLOCKING tool call [${event.toolName}] — loop detected (${loopResult.loopType}, repeats=${loopResult.repeatedActions}, severity=${loopResult.severity})`,
            );

            return {
              block: true,
              blockReason: `Agent Guard: Loop detected (${loopResult.loopType}, ${loopResult.repeatedActions} repeats in ${loopResult.windowMs}ms window, severity=${loopResult.severity}). Stopping to prevent resource waste.`,
            };
          }
        }

        // Check 2: State verification block (consecutive verification failures)
        if (config.stateVerification) {
          const verifyBlockTime = loopAlertCooldown.get(`${sessionId}:verify_block`);
          if (verifyBlockTime && Date.now() - verifyBlockTime < 300000) {
            // Within 5 min of a verification block signal
            const failCount = verifyFailures.get(sessionId) || 0;
            api.logger.warn?.(
              `Agent Guard: BLOCKING tool call [${event.toolName}] — state verification failed ${failCount} consecutive times`,
            );

            return {
              block: true,
              blockReason: `Agent Guard: State verification failed ${failCount} consecutive times. Last tool call claimed success but actual state did not match. Stopping to prevent cascading failures.`,
            };
          }
        }
      },
      { priority: 90 }, // Higher priority = runs first, can block before other hooks
    );
  },
});
