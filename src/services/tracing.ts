/**
 * Lightweight tracing for the tool-calling orchestration loop.
 *
 * Generates trace IDs, captures tool execution timeline entries,
 * and produces run summaries for debugging and observability.
 */

// ---------------------------------------------------------------------------
// Trace ID generation
// ---------------------------------------------------------------------------

/** Generate a unique trace ID for a run (compact, URL-safe) */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
}

// ---------------------------------------------------------------------------
// Tool timeline
// ---------------------------------------------------------------------------

export interface ToolTimelineEntry {
  stepNumber: number;
  toolName: string;
  args: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'started' | 'success' | 'error' | 'timeout' | 'cancelled';
  error?: string;
  resultSummary?: string;
}

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'completed'          // Model returned final text answer
  | 'max_steps_reached'  // Hit MAX_TOOL_ROUNDS limit
  | 'error'              // Unrecoverable error
  | 'cancelled'          // User or system aborted
  | 'insufficient_credits'; // Both token types exhausted

export interface RunSummary {
  traceId: string;
  status: RunStatus;
  stepCount: number;
  toolTimeline: ToolTimelineEntry[];
  completedTools: string[];
  totalDurationMs: number;
  startTime: number;
  endTime: number;
}

// ---------------------------------------------------------------------------
// Run tracker
// ---------------------------------------------------------------------------

/** Tracks a single orchestration run for observability */
export class RunTracker {
  readonly traceId: string;
  private startTime: number;
  private stepCount = 0;
  private timeline: ToolTimelineEntry[] = [];
  private status: RunStatus = 'completed';

  constructor(traceId?: string) {
    this.traceId = traceId ?? generateTraceId();
    this.startTime = performance.now();
  }

  /** Record the start of a tool execution */
  toolStarted(toolName: string, args: Record<string, unknown>): number {
    this.stepCount++;
    const entry: ToolTimelineEntry = {
      stepNumber: this.stepCount,
      toolName,
      args,
      startTime: performance.now(),
      status: 'started',
    };
    this.timeline.push(entry);
    return this.timeline.length - 1; // return index for later update
  }

  /** Record the completion of a tool execution */
  toolCompleted(index: number, result: string): void {
    const entry = this.timeline[index];
    if (!entry) return;
    entry.endTime = performance.now();
    entry.durationMs = Math.round(entry.endTime - entry.startTime);
    entry.status = 'success';
    // Capture a compact result summary (first 200 chars)
    try {
      const parsed = JSON.parse(result);
      if (parsed.error) {
        entry.status = 'error';
        entry.error = parsed.message || parsed.error;
      } else {
        const urls = [
          ...(parsed.resultUrls || []),
          ...(parsed.videoResultUrls || []),
          ...(parsed.audioResultUrls || []),
        ];
        entry.resultSummary = urls.length > 0
          ? `${urls.length} result(s)`
          : result.substring(0, 200);
      }
    } catch {
      entry.resultSummary = result.substring(0, 200);
    }
  }

  /** Record a tool error */
  toolErrored(index: number, error: string): void {
    const entry = this.timeline[index];
    if (!entry) return;
    entry.endTime = performance.now();
    entry.durationMs = Math.round(entry.endTime - entry.startTime);
    entry.status = 'error';
    entry.error = error;
  }

  /** Set the final run status */
  setStatus(status: RunStatus): void {
    this.status = status;
  }

  /** Get the current step count */
  getStepCount(): number {
    return this.stepCount;
  }

  /** Build the final run summary */
  getSummary(): RunSummary {
    const endTime = performance.now();
    return {
      traceId: this.traceId,
      status: this.status,
      stepCount: this.stepCount,
      toolTimeline: this.timeline,
      completedTools: this.timeline
        .filter(e => e.status === 'success')
        .map(e => e.toolName),
      totalDurationMs: Math.round(endTime - this.startTime),
      startTime: this.startTime,
      endTime,
    };
  }
}
