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
declare const _default: any;
export default _default;
//# sourceMappingURL=index.d.ts.map