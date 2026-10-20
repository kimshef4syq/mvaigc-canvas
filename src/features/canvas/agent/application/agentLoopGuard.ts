export interface LoopGuardTripResult {
  blocked: boolean;
  fingerprint: string;
  code?: 'LOOP_GUARD_BLOCKED' | 'CONSECUTIVE_FAILURE_BLOCKED';
  reason?: string;
  advice?: string[];
}

export interface LoopGuardHistoryItem {
  toolName: string;
  fingerprint: string;
  rawArgs: unknown;
  timestamp: number;
  success?: boolean;
  error?: string;
}

const NON_SUBSTANTIVE_KEYS = new Set([
  'callid',
  'requestid',
  'timestamp',
  'runid',
  'projectid',
  'expectedrevision',
  'reveal',
]);

/**
 * Normalizes tool arguments so trivial formatting, punctuation tweaks,
 * and slight duration shifts map to identical semantic fingerprints.
 */
export function normalizeToolArguments(toolName: string, args: unknown): string {
  if (args === null || args === undefined) return `${toolName}:null`;
  if (typeof args !== 'object') {
    const str = String(args).trim().toLowerCase().replace(/[.,!?;:，。！？；：\s]+/g, ' ');
    return `${toolName}:${str}`;
  }

  const normalized = normalizeValue(args);
  return `${toolName}:${JSON.stringify(normalized)}`;
}

function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // Round floating numbers (e.g. durations 5.01 vs 5.0) to 1 decimal place
    return Math.round(val * 10) / 10;
  }
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    // Lowercase, remove common punctuation, collapse spaces
    const collapsed = val.trim().toLowerCase();
    const withoutPunctuation = collapsed.replace(/[.,!?;:，。！？；：]+/g, ' ');
    return withoutPunctuation.replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(val)) {
    return val.map((item) => normalizeValue(item));
  }
  if (typeof val === 'object') {
    const record = val as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((k) => !NON_SUBSTANTIVE_KEYS.has(k.toLowerCase()))
      .sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = normalizeValue(record[key]);
    }
    return result;
  }
  return String(val);
}

export class AgentLoopGuard {
  private runs = new Map<string, LoopGuardHistoryItem[]>();

  private getHistory(runId: string): LoopGuardHistoryItem[] {
    let history = this.runs.get(runId);
    if (!history) {
      history = [];
      this.runs.set(runId, history);
    }
    return history;
  }

  /**
   * Pre-check before executing a tool call.
   * Enforces:
   * 1. 2 consecutive identical failures -> trip ConsecutiveFailure.
   * 2. 3 identical fingerprints in the last 5 calls -> trip LoopGuard.
   */
  check(runId: string, toolName: string, args: unknown): LoopGuardTripResult {
    const fingerprint = normalizeToolArguments(toolName, args);
    const history = this.getHistory(runId);

    // Check consecutive failure rule first
    const matchingRecent = history.slice(-5).reverse();
    let consecutiveFailures = 0;
    for (const item of matchingRecent) {
      if (item.fingerprint === fingerprint) {
        if (item.success === false) {
          consecutiveFailures++;
        } else {
          break;
        }
      }
    }

    if (consecutiveFailures >= 2) {
      return {
        blocked: true,
        fingerprint,
        code: 'CONSECUTIVE_FAILURE_BLOCKED',
        reason: `LoopGuard blocked: tool '${toolName}' failed with identical arguments 2 consecutive times.`,
        advice: [
          '1. Do not repeat failed arguments.',
          '2. Inspect failure diagnostics or switch fallback parameters.',
          '3. Stop and request user intervention.',
        ],
      };
    }

    // Check sliding window of last 5 calls
    const windowSlice = history.slice(-5);
    const occurrences = windowSlice.filter((item) => item.fingerprint === fingerprint).length;

    if (occurrences >= 2) {
      // This call would be the 3rd occurrence in 5 calls
      return {
        blocked: true,
        fingerprint,
        code: 'LOOP_GUARD_BLOCKED',
        reason: `LoopGuard blocked: tool '${toolName}' invoked with identical semantic arguments 3 times in recent calls.`,
        advice: [
          '1. Choose a different tool or model.',
          '2. Substantively modify prompt or input parameters.',
          '3. Stop and request user clarification.',
        ],
      };
    }

    return { blocked: false, fingerprint };
  }

  /**
   * Records a tool call dispatch in the history.
   */
  recordCall(runId: string, toolName: string, args: unknown): LoopGuardTripResult {
    const checkResult = this.check(runId, toolName, args);
    if (checkResult.blocked) return checkResult;

    const history = this.getHistory(runId);
    history.push({
      toolName,
      fingerprint: checkResult.fingerprint,
      rawArgs: args,
      timestamp: Date.now(),
    });

    // Keep bounded history (last 50 calls)
    if (history.length > 50) {
      history.shift();
    }

    return checkResult;
  }

  /**
   * Records the outcome of a tool execution.
   */
  recordResult(runId: string, toolName: string, args: unknown, success: boolean, error?: string): void {
    const fingerprint = normalizeToolArguments(toolName, args);
    const history = this.getHistory(runId);
    // Update the latest matching entry
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].fingerprint === fingerprint && history[i].success === undefined) {
        history[i].success = success;
        history[i].error = error;
        break;
      }
    }
  }

  clear(runId: string): void {
    this.runs.delete(runId);
  }
}

export const agentLoopGuard = new AgentLoopGuard();
