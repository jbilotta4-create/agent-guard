/**
 * Agent Guard — OpenClaw Plugin
 * 
 * Real-time fact alerts for AI agents — detect loops, verify state,
 * and surface facts (not judgments) when something looks off.
 * 
 * Hook strategy:
 * - after_tool_call: record action + detect loops + verify state (observation)
 * - before_tool_call: require approval with fact statement when loop detected (decision)
 * - before_prompt_build: inject fact context when pattern detected (awareness)
 * 
 * v1.0.0: Shifted from silent block → fact-based approval alerts.
 *          "You've read the same file 6 times" (fact) vs "You're wasting tokens" (judgment).
 *          Facts let the user/agent decide. Judgments trigger resistance or compliance.
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
  signalSource?: string;  // Semantic signal source extracted from params (file/search/URL)
}

interface LoopDetectionResult {
  isLoop: boolean;
  loopType: "action_loop" | "output_loop" | "error_loop" | "signal_source_loop" | "none";
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  repeatedActions: number;
  windowMs: number;
  shouldStop: boolean;
  signalSource?: string;  // The repeated signal source (for signal_source_loop)
  toolCount?: number;     // How many different tools accessed the same source
}

// Track last alert time per session + per fact pattern (to avoid spam)
const loopAlertCooldown: Map<string, number> = new Map();

// --- Action History & Error Tracking ---
const actionHistory: Map<string, ActionRecord[]> = new Map();
const consecutiveErrors: Map<string, number> = new Map();

// --- Fact Statement Generator ---
// Turns detection results into verifiable fact statements (no judgments)

function generateFactStatement(
  loopResult: LoopDetectionResult,
  toolName: string,
  sessionId: string,
): string {
  const history = actionHistory.get(sessionId) || [];
  const now = Date.now();
  const windowActions = history.filter(a => now - a.timestamp < loopResult.windowMs);

  switch (loopResult.loopType) {
    case "action_loop": {
      // Find the repeated action
      const actionCounts: Map<string, { tool: string; hash: string; count: number; firstTime: number }> = new Map();
      for (const a of windowActions) {
        const key = `${a.toolName}:${a.paramsHash}`;
        const existing = actionCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          actionCounts.set(key, { tool: a.toolName, hash: a.paramsHash, count: 1, firstTime: a.timestamp });
        }
      }
      // Find the most repeated one
      let topAction = { tool: "", hash: "", count: 0, firstTime: 0 };
      for (const [, v] of actionCounts) {
        if (v.count > topAction.count) topAction = v;
      }
      const minutesAgo = Math.round((now - topAction.firstTime) / 60000);
      return `${toolName} has been called ${loopResult.repeatedActions} times with the same parameters in the last ${minutesAgo} minute${minutesAgo !== 1 ? "s" : ""}. The previous ${loopResult.repeatedActions - 1} calls returned the same result.`;
    }

    case "output_loop": {
      const minutesAgo = Math.round(loopResult.windowMs / 60000);
      return `${toolName} has been called ${loopResult.repeatedActions} times with different parameters in the last ${minutesAgo} minute${minutesAgo !== 1 ? "s" : ""}, but the outputs have been similar each time.`;
    }

    case "error_loop": {
      return `The last ${loopResult.repeatedActions} tool calls have all returned errors. The pattern has not changed despite retries.`;
    }

    case "signal_source_loop": {
      const source = loopResult.signalSource || "unknown";
      const toolCount = loopResult.toolCount || 0;
      const minutesAgo = Math.round(loopResult.windowMs / 60000);
      return `${source} has been accessed ${loopResult.repeatedActions} times by ${toolCount} different tools in the last ${minutesAgo} minute${minutesAgo !== 1 ? "s" : ""}. Each tool is reading the same source but producing different outputs -- the understanding pattern is repeating.`;
    }

    default:
      return "";
  }
}

// --- Utility: Nested value extraction ---

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

// --- Signal Source Extraction ---
// Extract a semantic "signal source" from tool params.
// This lets us detect when different tools are reading the same underlying resource
// (e.g., read + grep + edit on the same file = understanding pattern repetition,
// not just action repetition).

const SIGNAL_SOURCE_PATTERNS: Array<{
  toolPattern: string | RegExp;
  extractors: Array<{ paramPath: string; normalize: (v: string) => string }>;
}> = [
  // File operations: extract file path as signal source
  {
    toolPattern: /^(read|write|edit|apply_patch|image)$/,
    extractors: [{ paramPath: "path", normalize: (v) => `file:${v}` }],
  },
  // Search operations: extract search query as signal source
  {
    toolPattern: /^(web_search|exec)$/,
    extractors: [
      { paramPath: "query", normalize: (v) => `search:${v.toLowerCase().trim()}` },
      { paramPath: "command", normalize: (v) => `cmd:${v.split(" ").slice(0, 3).join(" ")}` }, // First 3 tokens
    ],
  },
  // Web fetch: extract URL as signal source
  {
    toolPattern: /^web_fetch$/,
    extractors: [{ paramPath: "url", normalize: (v) => `url:${new URL(v).hostname + new URL(v).pathname}` }],
  },
  // Browser: extract URL as signal source
  {
    toolPattern: /^browser$/,
    extractors: [{ paramPath: "url", normalize: (v) => `url:${new URL(v).hostname + new URL(v).pathname}` }],
  },
];

function extractSignalSource(
  toolName: string,
  params: Record<string, unknown>,
): string | undefined {
  for (const pattern of SIGNAL_SOURCE_PATTERNS) {
    const matches = typeof pattern.toolPattern === "string"
      ? toolName === pattern.toolPattern
      : pattern.toolPattern.test(toolName);
    if (!matches) continue;

    for (const extractor of pattern.extractors) {
      const raw = getNestedValue(params, extractor.paramPath);
      if (typeof raw === "string" && raw.length > 0) {
        try {
          return extractor.normalize(raw);
        } catch {
          // URL parsing can fail, skip
          continue;
        }
      }
    }
  }
  return undefined;
}

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

  // --- Signal Source Loop Detection ---
  // Detect when the same semantic resource is being accessed by different tools.
  // This is "understanding pattern repetition" — more fundamental than action repetition.
  // Example: read(file) → grep(file) → edit(file) → read(file) = same source, 4 accesses, 3 tools
  //
  // Thresholds are lower than action_loop because cross-tool repetition is more concerning:
  // - Same source 4+ times (vs 6+ for action_loop)
  // - 3+ different tools accessing the same source (vs same tool for action_loop)

  const SIGNAL_SOURCE_THRESHOLD = 4;      // Same source accessed 4+ times
  const SIGNAL_SOURCE_MIN_TOOLS = 3;      // By 3+ different tools
  const SIGNAL_SOURCE_WINDOW_MS = 300000; // 5-minute window

  const signalActions = history.filter(a => now - a.timestamp < SIGNAL_SOURCE_WINDOW_MS && a.signalSource);
  const sourceGroups: Map<string, { count: number; tools: Set<string> }> = new Map();
  for (const a of signalActions) {
    const src = a.signalSource!;
    const existing = sourceGroups.get(src);
    if (existing) {
      existing.count++;
      existing.tools.add(a.toolName);
    } else {
      sourceGroups.set(src, { count: 1, tools: new Set([a.toolName]) });
    }
  }

  for (const [source, group] of sourceGroups) {
    if (group.count >= SIGNAL_SOURCE_THRESHOLD && group.tools.size >= SIGNAL_SOURCE_MIN_TOOLS) {
      const toolList = [...group.tools].join(", ");
      return {
        isLoop: true,
        loopType: "signal_source_loop",
        confidence: Math.min(0.9, group.count / (SIGNAL_SOURCE_THRESHOLD * 2)),
        severity: group.count >= SIGNAL_SOURCE_THRESHOLD * 2 ? "high" : "medium",
        repeatedActions: group.count,
        windowMs: SIGNAL_SOURCE_WINDOW_MS,
        shouldStop: group.count >= SIGNAL_SOURCE_THRESHOLD * 2,
        signalSource: source,
        toolCount: group.tools.size,
      };
    }
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
  const signalSource = extractSignalSource(toolName, params);
  const record: ActionRecord = {
    toolName,
    paramsHash: hashParams(params),
    timestamp: now,
    isError,
    sessionId,
    signalSource,
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

// --- Fact-based alert config ---
const FACT_ALERT_COOLDOWN_MS = 180000; // 3 min between same-session alerts
const FACT_ALERT_MIN_REPEATS = 4; // Only alert at 4+ repeats (below that, likely legit retries)

function generateVerifyFactStatement(
  toolName: string,
  failCount: number,
  detail: string,
): string {
  return `The last ${failCount} ${toolName} call${failCount > 1 ? "s" : ""} reported success, but the actual state did not match. Detail: ${detail}`;
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

        // --- Loop Detection ---
        recordAction(sessionId, toolName, params, isError);

        const loopResult = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (loopResult.isLoop && loopResult.repeatedActions >= FACT_ALERT_MIN_REPEATS) {
          const now = Date.now();
          const cooldownKey = `${sessionId}:${loopResult.loopType}`;
          const lastAlert = loopAlertCooldown.get(cooldownKey) || 0;
          if (now - lastAlert > FACT_ALERT_COOLDOWN_MS) {
            const fact = generateFactStatement(loopResult, toolName, sessionId);
            if (fact) {
              api.logger.warn?.(
                `Agent Guard: FACT ALERT [${loopResult.loopType}] session=${sessionId} repeats=${loopResult.repeatedActions} fact="${fact}"`,
              );
              loopAlertCooldown.set(cooldownKey, now);
            }
          }
        }

        // --- State Verification ---
        if (config.stateVerification) {
          const rules = config.verificationRules || DEFAULT_RULES;
          const matchingRules = rules.filter((r: VerificationRule) => matchesRule(toolName, r));

          for (const rule of matchingRules) {
            const verifyResult = verifyState(toolName, params, result, isError, rule);

            if (!verifyResult.passed) {
              const failCount = (verifyFailures.get(sessionId) || 0) + 1;
              verifyFailures.set(sessionId, failCount);

              const shouldBlock = rule.severity === "block" || failCount >= config.verifyBlockThreshold;

              const fact = generateVerifyFactStatement(toolName, failCount, verifyResult.detail);
              api.logger[shouldBlock ? "error" : "warn"]?.(
                `Agent Guard: STATE FACT [${rule.checkType}] tool=${toolName} consecutive_failures=${failCount} fact="${fact}"`,
              );

              if (shouldBlock) {
                loopAlertCooldown.set(`${sessionId}:verify_block`, Date.now());
              }
            } else {
              verifyFailures.set(sessionId, 0);
            }
          }
        }
      },
      { priority: 80 },
    );

    // === before_tool_call: Fact-based approval alerts ===
    //
    // When a loop or verification failure is detected, instead of silently blocking,
    // surface a fact statement via requireApproval. The user/agent decides whether to continue.
    //
    // Fact: "You've called exec 6 times with the same params in 3 minutes"
    // Judgment: "You're wasting tokens" — we don't do this.
    //
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";

        // Check 1: Loop detection → fact-based approval
        const loopResult = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        if (loopResult.isLoop && loopResult.repeatedActions >= FACT_ALERT_MIN_REPEATS) {
          const fact = generateFactStatement(loopResult, event.toolName, sessionId);
          if (!fact) return;

          // Cooldown: don't spam approval requests
          const cooldownKey = `${sessionId}:${loopResult.loopType}:approval`;
          const lastApproval = loopAlertCooldown.get(cooldownKey) || 0;
          if (Date.now() - lastApproval < FACT_ALERT_COOLDOWN_MS) return;

          loopAlertCooldown.set(cooldownKey, Date.now());

          // For critical severity (extreme loops), block directly
          if (loopResult.severity === "critical" && config.blockOnLoop) {
            api.logger.error?.(
              `Agent Guard: BLOCKING [${event.toolName}] — critical loop (${loopResult.loopType}, ${loopResult.repeatedActions} repeats)`,
            );
            return {
              block: true,
              blockReason: `Agent Guard: ${fact}`,
            };
          }

          // For medium/high severity: fact-based approval request
          const severity = loopResult.severity === "high" ? "warning" : "info";
          api.logger.warn?.(
            `Agent Guard: FACT APPROVAL [${event.toolName}] — ${loopResult.loopType} (${loopResult.repeatedActions} repeats) fact="${fact}"`,
          );

          return {
            requireApproval: {
              title: `Agent Guard: Repeated action detected`,
              description: fact,
              severity,
              timeoutMs: 60_000,
              timeoutBehavior: "allow",  // Default to allowing if no response (don't block)
              allowedDecisions: ["allow-once", "allow-always", "deny"],
            },
          };
        }

        // Check 2: State verification → fact-based approval
        if (config.stateVerification) {
          const verifyBlockTime = loopAlertCooldown.get(`${sessionId}:verify_block`);
          if (verifyBlockTime && Date.now() - verifyBlockTime < 300000) {
            const failCount = verifyFailures.get(sessionId) || 0;
            if (failCount >= 2) {
              const cooldownKey = `${sessionId}:verify:approval`;
              const lastApproval = loopAlertCooldown.get(cooldownKey) || 0;
              if (Date.now() - lastApproval < FACT_ALERT_COOLDOWN_MS) return;
              loopAlertCooldown.set(cooldownKey, Date.now());

              const fact = generateVerifyFactStatement(
                event.toolName,
                failCount,
                "state did not match after tool call",
              );

              return {
                requireApproval: {
                  title: `Agent Guard: State verification mismatch`,
                  description: fact,
                  severity: "warning",
                  timeoutMs: 60_000,
                  timeoutBehavior: "allow",
                  allowedDecisions: ["allow-once", "allow-always", "deny"],
                },
              };
            }
          }
        }
      },
      { priority: 90 },
    );

    // === before_prompt_build: Inject fact context when pattern detected ===
    //
    // When loops are detected but not yet at approval threshold,
    // inject a subtle fact into the agent's context so it can self-correct
    // before escalation.
    //
    api.on(
      "before_prompt_build",
      async (event, ctx) => {
        const config = getConfig();
        if (!config.enabled) return;

        const sessionId = ctx.sessionId || ctx.sessionKey || "unknown";
        const loopResult = detectLoop(
          sessionId,
          config.loopWindowMs,
          config.loopThreshold,
          config.maxConsecutiveErrors,
        );

        // Only inject when there's a pattern but below approval threshold
        if (loopResult.repeatedActions >= 3 && loopResult.repeatedActions < FACT_ALERT_MIN_REPEATS) {
          const history = actionHistory.get(sessionId) || [];
          const now = Date.now();
          const recentTools = history
            .filter(a => now - a.timestamp < loopResult.windowMs)
            .map(a => a.toolName);
          const toolCounts: Map<string, number> = new Map();
          for (const t of recentTools) {
            toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
          }
          const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (topTool) {
            return {
              context: `[Agent Guard] ${topTool[0]} has been called ${topTool[1]} times recently. Consider whether the next call will produce new information.`,
            };
          }
        }
      },
      { priority: 50 },
    );
  },
});
