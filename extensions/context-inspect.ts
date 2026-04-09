import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type CountBucket = {
  estimatedTokens: number;
  count: number;
};

type Analysis = {
  source: "captured-context" | "branch-fallback";
  systemPrompt: string;
  systemTokensEstimated: number;
  skillsAdvertised: number;
  summary: CountBucket & { compactions: number; branchSummaries: number };
  user: CountBucket & { messages: number };
  assistantText: CountBucket & { messages: number };
  thinking: CountBucket & { blocks: number };
  toolCalls: CountBucket & { calls: number };
  toolResults: CountBucket & { messages: number };
  bashExecution: CountBucket & { messages: number };
  custom: CountBucket & { messages: number };
  other: CountBucket & { messages: number };
};

type CapturedState = Analysis | null;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function contentTextLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;

  let total = 0;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const part = item as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      total += part.text.length;
    } else if (part.type === "thinking" && typeof part.thinking === "string") {
      total += part.thinking.length;
    } else {
      total += JSON.stringify(part).length;
    }
  }
  return total;
}

function formatTokens(tokens: number): string {
  if (tokens >= 100_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

function formatPct(part: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatUsagePercent(percent: number | null | undefined, used: number, total: number): string {
  if (typeof percent === "number" && Number.isFinite(percent)) {
    return `${percent.toFixed(1)}%`;
  }
  return formatPct(used, total);
}

function row(indent: number, label: string, tokens: number, pct: string, details?: string): string {
  const left = `${"  ".repeat(indent)}${label}`;
  const base = `${left.padEnd(24)} ${formatTokens(tokens).padStart(6)} tok   ${pct.padStart(6)}`;
  return details ? `${base}  ${details}` : base;
}

function countRow(indent: number, label: string, count: number, details?: string): string {
  const left = `${"  ".repeat(indent)}${label}`;
  const base = `${left.padEnd(24)} ${String(count).padStart(6)}`;
  return details ? `${base}  ${details}` : base;
}

function apportion(total: number, estimates: number[]): number[] {
  if (total <= 0) return estimates.map(() => 0);
  const estimateTotal = estimates.reduce((a, b) => a + b, 0);
  if (estimateTotal <= 0) {
    const result = estimates.map(() => 0);
    if (result.length > 0) result[result.length - 1] = total;
    return result;
  }

  const raw = estimates.map((estimate) => (estimate / estimateTotal) * total);
  const base = raw.map((value) => Math.floor(value));
  let assigned = base.reduce((a, b) => a + b, 0);
  const remainders = raw
    .map((value, index) => ({ index, remainder: value - base[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  let cursor = 0;
  while (assigned < total && cursor < remainders.length) {
    base[remainders[cursor].index] += 1;
    assigned += 1;
    cursor += 1;
  }

  return base;
}

function blankAnalysis(source: Analysis["source"], systemPrompt: string): Analysis {
  const skillsAdvertised = (systemPrompt.match(/<skill[^>]*>/g) ?? []).length;
  return {
    source,
    systemPrompt,
    systemTokensEstimated: estimateTokens(systemPrompt),
    skillsAdvertised,
    summary: { estimatedTokens: 0, count: 0, compactions: 0, branchSummaries: 0 },
    user: { estimatedTokens: 0, count: 0, messages: 0 },
    assistantText: { estimatedTokens: 0, count: 0, messages: 0 },
    thinking: { estimatedTokens: 0, count: 0, blocks: 0 },
    toolCalls: { estimatedTokens: 0, count: 0, calls: 0 },
    toolResults: { estimatedTokens: 0, count: 0, messages: 0 },
    bashExecution: { estimatedTokens: 0, count: 0, messages: 0 },
    custom: { estimatedTokens: 0, count: 0, messages: 0 },
    other: { estimatedTokens: 0, count: 0, messages: 0 },
  };
}

function analyzeMessages(messages: unknown[], source: Analysis["source"], systemPrompt: string): Analysis {
  const analysis = blankAnalysis(source, systemPrompt);

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const m = message as Record<string, unknown>;
    const role = m.role;

    if (role === "user") {
      analysis.user.messages += 1;
      analysis.user.count += 1;
      analysis.user.estimatedTokens += estimateTokensFromUnknownContent(m.content);
      continue;
    }

    if (role === "assistant") {
      analysis.assistantText.messages += 1;
      const content = Array.isArray(m.content) ? m.content : [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const part = item as Record<string, unknown>;
        if (part.type === "text" && typeof part.text === "string") {
          analysis.assistantText.estimatedTokens += estimateTokens(part.text);
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          analysis.thinking.blocks += 1;
          analysis.thinking.count += 1;
          analysis.thinking.estimatedTokens += estimateTokens(part.thinking);
        } else if (part.type === "toolCall") {
          analysis.toolCalls.calls += 1;
          analysis.toolCalls.count += 1;
          analysis.toolCalls.estimatedTokens += estimateTokens(JSON.stringify(part));
        } else {
          analysis.other.messages += 1;
          analysis.other.count += 1;
          analysis.other.estimatedTokens += estimateTokens(JSON.stringify(part));
        }
      }
      continue;
    }

    if (role === "toolResult") {
      analysis.toolResults.messages += 1;
      analysis.toolResults.count += 1;
      analysis.toolResults.estimatedTokens += estimateTokensFromUnknownContent(m.content);
      continue;
    }

    if (role === "compactionSummary") {
      analysis.summary.compactions += 1;
      analysis.summary.count += 1;
      analysis.summary.estimatedTokens += estimateTokens(typeof m.summary === "string" ? m.summary : JSON.stringify(m));
      continue;
    }

    if (role === "branchSummary") {
      analysis.summary.branchSummaries += 1;
      analysis.summary.count += 1;
      analysis.summary.estimatedTokens += estimateTokens(typeof m.summary === "string" ? m.summary : JSON.stringify(m));
      continue;
    }

    if (role === "bashExecution") {
      analysis.bashExecution.messages += 1;
      analysis.bashExecution.count += 1;
      const command = typeof m.command === "string" ? m.command : "";
      const output = typeof m.output === "string" ? m.output : "";
      analysis.bashExecution.estimatedTokens += estimateTokens(command + output);
      continue;
    }

    if (role === "custom") {
      analysis.custom.messages += 1;
      analysis.custom.count += 1;
      analysis.custom.estimatedTokens += estimateTokensFromUnknownContent(m.content);
      continue;
    }

    analysis.other.messages += 1;
    analysis.other.count += 1;
    analysis.other.estimatedTokens += estimateTokens(JSON.stringify(m));
  }

  return analysis;
}

function estimateTokensFromUnknownContent(content: unknown): number {
  return estimateTokensFromChars(contentTextLength(content));
}

function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

function fallbackMessagesFromBranch(entries: unknown[]): unknown[] {
  const messages: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type === "message" && e.message) {
      messages.push(e.message);
    } else if (e.type === "compaction") {
      messages.push({
        role: "compactionSummary",
        summary: typeof e.summary === "string" ? e.summary : "",
        tokensBefore: e.tokensBefore,
        timestamp: e.timestamp,
      });
    } else if (e.type === "branch_summary") {
      messages.push({
        role: "branchSummary",
        summary: typeof e.summary === "string" ? e.summary : "",
        fromId: e.fromId,
        timestamp: e.timestamp,
      });
    } else if (e.type === "custom_message") {
      messages.push({
        role: "custom",
        content: e.content,
        timestamp: e.timestamp,
      });
    }
  }
  return messages;
}

export default function contextInspect(pi: ExtensionAPI) {
  let latestCaptured: CapturedState = null;

  pi.on("session_start", () => {
    latestCaptured = null;
  });

  pi.on("context", (event, ctx) => {
    latestCaptured = analyzeMessages(event.messages, "captured-context", ctx.getSystemPrompt());
  });

  pi.registerCommand("context-inspect", {
    description: "Inspect current context window usage",
    handler: async (_args, ctx) => {
      const usage = ctx.getContextUsage();
      const analysis = latestCaptured
        ? latestCaptured
        : analyzeMessages(fallbackMessagesFromBranch(ctx.sessionManager.getBranch()), "branch-fallback", ctx.getSystemPrompt());

      const usedTotal = typeof usage?.tokens === "number"
        ? usage.tokens
        : analysis.systemTokensEstimated
          + analysis.summary.estimatedTokens
          + analysis.user.estimatedTokens
          + analysis.assistantText.estimatedTokens
          + analysis.thinking.estimatedTokens
          + analysis.toolCalls.estimatedTokens
          + analysis.toolResults.estimatedTokens
          + analysis.bashExecution.estimatedTokens
          + analysis.custom.estimatedTokens
          + analysis.other.estimatedTokens;

      const contextWindow = typeof usage?.contextWindow === "number" ? usage.contextWindow : usedTotal;
      const freeTokens = Math.max(0, contextWindow - usedTotal);
      const usedSystemTokens = Math.min(analysis.systemTokensEstimated, usedTotal);
      const nonSystemBudget = Math.max(0, usedTotal - usedSystemTokens);

      const estimatedBuckets = [
        analysis.summary.estimatedTokens,
        analysis.user.estimatedTokens,
        analysis.assistantText.estimatedTokens,
        analysis.thinking.estimatedTokens,
        analysis.toolCalls.estimatedTokens,
        analysis.toolResults.estimatedTokens,
        analysis.bashExecution.estimatedTokens,
        analysis.custom.estimatedTokens,
        analysis.other.estimatedTokens,
      ];

      const apportioned = apportion(nonSystemBudget, estimatedBuckets);
      const [
        usedSummaryTokens,
        usedUserTokens,
        usedAssistantTextTokens,
        usedThinkingTokens,
        usedToolCallTokens,
        usedToolResultTokens,
        usedBashExecutionTokens,
        usedCustomTokens,
        usedOtherTokens,
      ] = apportioned;

      const messageContextTokens =
        usedUserTokens +
        usedAssistantTextTokens +
        usedThinkingTokens +
        usedToolCallTokens +
        usedToolResultTokens +
        usedBashExecutionTokens +
        usedCustomTokens +
        usedOtherTokens;

      const lines: string[] = [];
      lines.push("Context Inspect");
      lines.push("");
      lines.push("Notes");
      lines.push(`- ${analysis.source === "captured-context" ? "Latest captured request." : "Current branch fallback (send one prompt after reload to capture a request)."}`);
      lines.push("- Subtotals are estimated and normalized to match “used”.");
      lines.push("- Pi exposes total usage, not a built-in per-layer token breakdown.");
      lines.push("");
      lines.push("Breakdown");
      lines.push(row(1, "used", usedTotal, formatUsagePercent(usage?.percent, usedTotal, contextWindow)));
      lines.push(row(2, "system prompt", usedSystemTokens, formatPct(usedSystemTokens, contextWindow), `${analysis.systemPrompt.length.toLocaleString()} chars, approx`));
      if (analysis.skillsAdvertised > 0) {
        lines.push(countRow(3, "skills advertised", analysis.skillsAdvertised));
      }
      lines.push(row(2, "summarized history", usedSummaryTokens, formatPct(usedSummaryTokens, contextWindow), `${analysis.summary.compactions} compactions, ${analysis.summary.branchSummaries} branch summaries, approx`));
      lines.push(row(2, "message context", messageContextTokens, formatPct(messageContextTokens, contextWindow), analysis.source === "captured-context" ? "latest captured request, approx" : "current branch fallback, approx"));
      lines.push(row(3, "user", usedUserTokens, formatPct(usedUserTokens, contextWindow), `${analysis.user.messages} messages`));
      lines.push(row(3, "assistant text", usedAssistantTextTokens, formatPct(usedAssistantTextTokens, contextWindow), `${analysis.assistantText.messages} messages`));
      lines.push(row(3, "thinking", usedThinkingTokens, formatPct(usedThinkingTokens, contextWindow), `${analysis.thinking.blocks} blocks`));
      lines.push(row(3, "tool calls", usedToolCallTokens, formatPct(usedToolCallTokens, contextWindow), `${analysis.toolCalls.calls} calls`));
      lines.push(row(3, "tool results", usedToolResultTokens, formatPct(usedToolResultTokens, contextWindow), `${analysis.toolResults.messages} messages`));
      if (analysis.bashExecution.messages > 0) {
        lines.push(row(3, "bash execution", usedBashExecutionTokens, formatPct(usedBashExecutionTokens, contextWindow), `${analysis.bashExecution.messages} messages`));
      }
      if (analysis.custom.messages > 0) {
        lines.push(row(3, "custom messages", usedCustomTokens, formatPct(usedCustomTokens, contextWindow), `${analysis.custom.messages} messages`));
      }
      if (analysis.other.messages > 0) {
        lines.push(row(3, "other", usedOtherTokens, formatPct(usedOtherTokens, contextWindow), `${analysis.other.messages} messages`));
      }
      lines.push(row(1, "free", freeTokens, formatPct(freeTokens, contextWindow)));
      lines.push("  " + "-".repeat(56));
      lines.push(row(1, "context window", contextWindow, "100.0%"));

      await ctx.ui.editor("context-inspect", lines.join("\n"));
    },
  });
}
