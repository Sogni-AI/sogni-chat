/**
 * ToolPipeline — a reusable framework for multi-step tool orchestration.
 *
 * Chains tool executions with intermediate state, phased progress reporting,
 * and graceful error handling. Designed for composite tools that need to
 * orchestrate multiple sub-tools sequentially (e.g., orbit_video).
 */

import type { ToolExecutionContext, ToolCallbacks, ToolName } from '../types';
import { toolRegistry } from '../registry';

export interface PipelineState {
  imageUrls: string[];
  videoUrls: string[];
  data: Record<string, unknown>;
}

export interface StepResult {
  rawResult: string;
  imageUrls: string[];
  videoUrls: string[];
}

export interface PipelineStep {
  label: string;
  toolName: ToolName | null;
  count: number;
  /** Run all invocations concurrently via Promise.all (default: false — sequential). */
  concurrent?: boolean;
  /** Per-invocation labels for concurrent steps (e.g. angle names). Falls back to step.label. */
  itemLabels?: string[];
  /** Treat ANY sub-tool error as fatal (not just insufficient_credits/no_image). Default: false. */
  failOnAnyError?: boolean;
  buildArgs: (state: PipelineState, index: number) => Record<string, unknown>;
  customExecute?: (
    state: PipelineState,
    context: ToolExecutionContext,
    callbacks: ToolCallbacks,
  ) => Promise<StepResult[]>;
  collectResults: (state: PipelineState, results: StepResult[]) => PipelineState;
}

export interface PipelineConfig {
  parentToolName: ToolName;
  steps: PipelineStep[];
  initialState: PipelineState;
}

export async function executePipeline(
  config: PipelineConfig,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<PipelineState> {
  let state = { ...config.initialState };

  for (const step of config.steps) {
    if (context.signal?.aborted) {
      console.log(`[PIPELINE] Aborted before step: ${step.label}`);
      break;
    }

    console.log(`[PIPELINE] Starting step: ${step.label}`);
    const stepResults: StepResult[] = [];

    if (step.customExecute) {
      callbacks.onToolProgress({
        type: 'progress',
        toolName: config.parentToolName,
        stepLabel: step.label,
      });
      const results = await step.customExecute(state, context, callbacks);
      stepResults.push(...results);
    } else if (step.concurrent) {
      // ---------------------------------------------------------------
      // Concurrent execution — all invocations launched via Promise.all
      // ---------------------------------------------------------------
      console.log(`[PIPELINE] Running ${step.count} concurrent invocations of ${step.toolName}`);

      // Emit a single 'started' event with totalCount so the UI creates one
      // progress indicator with the right number of slots. Sub-tool 'started'
      // events are suppressed to prevent resetting perJobProgress.
      callbacks.onToolProgress({
        type: 'started',
        toolName: config.parentToolName,
        totalCount: step.count,
        stepLabel: step.label,
      });

      // Immediately emit per-job labels so the UI shows them from the start,
      // before any sub-tool progress events arrive.
      if (step.itemLabels) {
        for (let j = 0; j < step.count; j++) {
          if (step.itemLabels[j]) {
            callbacks.onToolProgress({
              type: 'progress',
              toolName: config.parentToolName,
              stepLabel: step.label,
              jobLabel: step.itemLabels[j],
              jobIndex: j,
              totalCount: step.count,
              completedCount: 0,
            });
          }
        }
      }

      // Pre-allocate result slots so concurrent callbacks write to the correct index
      const slotResults: StepResult[] = new Array(step.count).fill(null).map(() => ({
        rawResult: '',
        imageUrls: [],
        videoUrls: [],
      }));
      let completedCount = 0;

      const promises = Array.from({ length: step.count }, (_, i) => {
        const args = step.buildArgs(state, i);

        // Create a signal-isolated context for each concurrent invocation.
        // toolRegistry.execute() mutates context.signal (save/restore pattern)
        // which corrupts the signal for other concurrent calls sharing the same
        // context object. Object.create gives each invocation its own signal
        // property while preserving access to shared getters (resultUrls, etc.)
        // via the prototype chain.
        const invocationContext = Object.create(context) as ToolExecutionContext;

        const wrappedCallbacks: ToolCallbacks = {
          onToolProgress: (progress) => {
            // Suppress sub-tool 'started' events — we already emitted one above
            if (progress.type === 'started') return;
            // Extract video completion URL for per-slot display only —
            // do NOT forward via videoResultUrls (that would contaminate
            // message.videoResults with intermediate clip URLs, causing
            // duplicates and "Video expired" errors).
            const completedVideoUrl = progress.videoResultUrls?.[0];
            callbacks.onToolProgress({
              ...progress,
              toolName: config.parentToolName,
              stepLabel: step.label,
              jobLabel: step.itemLabels?.[i],
              jobIndex: i,
              totalCount: step.count,
              completedCount,
              // Strip intermediate result URLs — pipeline manages its own result
              // collection via onToolComplete. Leaking URLs would cause useChat to
              // accumulate them into message.videoResults / message.results,
              // creating duplicates and "Video expired" errors.
              resultUrls: undefined,
              videoResultUrls: undefined,
              // Strip sub-tool sourceImageUrl — each concurrent sub-tool has its own
              // source image (e.g. orbit transitions use different angle views).
              // Forwarding these would cause the top-level placeholder to rapidly
              // alternate between images on every progress event. The parent tool's
              // 'started' event sets the stable placeholder for all slots.
              sourceImageUrl: undefined,
              // Inject completed clip URL into perJobProgress for UI display
              // without leaking into message.videoResults accumulation.
              ...(completedVideoUrl ? {
                perJobProgress: {
                  [i]: { resultUrl: completedVideoUrl, isVideo: true, progress: 1 },
                },
              } : {}),
            });
          },
          onToolComplete: (_toolName, resultUrls, videoResultUrls) => {
            completedCount++;
            slotResults[i] = {
              ...slotResults[i],
              imageUrls: resultUrls || [],
              videoUrls: videoResultUrls || [],
            };
            // Push result URLs into context arrays so subsequent pipeline steps
            // can resolve them by index (e.g., orbit Step 2 finding Step 1 images).
            // context.resultUrls is a getter backed by a ref in useChat. push()
            // mutates the current backing array, but progress handlers may replace
            // the ref with a new array. Orbit's collectResults verifies URLs are
            // present before computing indices to guard against this.
            for (const url of (resultUrls || [])) {
              if (!context.resultUrls.includes(url)) context.resultUrls.push(url);
            }
            for (const url of (videoResultUrls || [])) {
              if (!context.videoResultUrls.includes(url)) context.videoResultUrls.push(url);
            }
          },
          onInsufficientCredits: callbacks.onInsufficientCredits,
          // Suppress intermediate gallery saves — sub-step gallery IDs would be
          // applied to the parent message at wrong indices. The pipeline's final
          // output handles its own gallery persistence via customExecute steps.
          onGallerySaved: undefined,
        };

        return toolRegistry.execute(step.toolName!, args, invocationContext, wrappedCallbacks)
          .then((rawResult) => {
            slotResults[i].rawResult = rawResult;

            // Check for fatal errors
            try {
              const parsed = JSON.parse(rawResult);
              if (parsed.error) {
                console.error(`[PIPELINE] Sub-tool error in "${step.label}" invocation ${i}:`, parsed.error, parsed.message);
                if (
                  step.failOnAnyError ||
                  parsed.error === 'insufficient_credits' ||
                  parsed.error === 'no_image'
                ) {
                  throw new Error(parsed.message || parsed.error);
                }
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
            }
          });
      });

      // Use allSettled so a single sub-tool failure doesn't abandon siblings
      // (which would continue running and consuming credits with no result collection).
      const settled = await Promise.allSettled(promises);
      const errors = settled
        .map((r, i) => r.status === 'rejected' ? { index: i, reason: r.reason } : null)
        .filter(Boolean) as { index: number; reason: unknown }[];
      if (errors.length > 0) {
        // Re-throw the first fatal error after all siblings have finished
        const firstError = errors[0];
        throw firstError.reason instanceof Error ? firstError.reason : new Error(String(firstError.reason));
      }
      stepResults.push(...slotResults);
    } else {
      // ---------------------------------------------------------------
      // Sequential execution — one invocation at a time
      // ---------------------------------------------------------------
      for (let i = 0; i < step.count; i++) {
        if (context.signal?.aborted) {
          console.log(`[PIPELINE] Aborted during step "${step.label}" at invocation ${i}`);
          break;
        }

        const args = step.buildArgs(state, i);
        const stepLabel = `${step.label} ${i + 1}/${step.count}`;

        const wrappedCallbacks: ToolCallbacks = {
          onToolProgress: (progress) => {
            if (progress.type === 'started') return;
            // Extract video completion URL for per-slot display only
            // (see concurrent path comment for full rationale).
            const completedVideoUrl = progress.videoResultUrls?.[0];
            callbacks.onToolProgress({
              ...progress,
              stepLabel,
              // Strip intermediate result URLs (see concurrent path comment).
              resultUrls: undefined,
              videoResultUrls: undefined,
              sourceImageUrl: undefined,
              // Inject completed clip URL into perJobProgress for UI display
              // without leaking into message.videoResults accumulation.
              ...(completedVideoUrl ? {
                perJobProgress: {
                  [i]: { resultUrl: completedVideoUrl, isVideo: true, progress: 1 },
                },
              } : {}),
            });
          },
          onToolComplete: (_toolName, resultUrls, videoResultUrls) => {
            stepResults.push({
              rawResult: '',
              imageUrls: resultUrls || [],
              videoUrls: videoResultUrls || [],
            });
            // Push result URLs into context for subsequent steps (see concurrent path comment)
            for (const url of (resultUrls || [])) {
              if (!context.resultUrls.includes(url)) context.resultUrls.push(url);
            }
            for (const url of (videoResultUrls || [])) {
              if (!context.videoResultUrls.includes(url)) context.videoResultUrls.push(url);
            }
          },
          onInsufficientCredits: callbacks.onInsufficientCredits,
          // Suppress intermediate gallery saves (see concurrent path comment)
          onGallerySaved: undefined,
        };

        console.log(`[PIPELINE] Executing ${step.toolName} (${i + 1}/${step.count})`);
        const rawResult = await toolRegistry.execute(
          step.toolName!,
          args,
          context,
          wrappedCallbacks,
        );

        try {
          const parsed = JSON.parse(rawResult);
          if (parsed.error) {
            console.error(`[PIPELINE] Sub-tool error in "${step.label}" invocation ${i}:`, parsed.error, parsed.message);
            if (
              step.failOnAnyError ||
              parsed.error === 'insufficient_credits' ||
              parsed.error === 'no_image'
            ) {
              throw new Error(parsed.message || parsed.error);
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            // Not JSON — treat as success
          } else {
            throw e;
          }
        }

        if (stepResults.length <= i) {
          stepResults.push({ rawResult, imageUrls: [], videoUrls: [] });
        } else {
          stepResults[i].rawResult = rawResult;
        }
      }
    }

    state = step.collectResults(state, stepResults);
    console.log(`[PIPELINE] Completed step: ${step.label} (${stepResults.length} results)`);
  }

  return state;
}
