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

      // Pre-allocate result slots so concurrent callbacks write to the correct index
      const slotResults: StepResult[] = new Array(step.count).fill(null).map(() => ({
        rawResult: '',
        imageUrls: [],
        videoUrls: [],
      }));
      let completedCount = 0;

      const promises = Array.from({ length: step.count }, (_, i) => {
        const args = step.buildArgs(state, i);

        const wrappedCallbacks: ToolCallbacks = {
          onToolProgress: (progress) => {
            // Suppress sub-tool 'started' events — we already emitted one above
            if (progress.type === 'started') return;
            callbacks.onToolProgress({
              ...progress,
              toolName: config.parentToolName,
              stepLabel: step.label,
              jobIndex: i,
              totalCount: step.count,
              completedCount,
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
            // context.resultUrls / context.videoResultUrls are array references
            // backed by refs in useChat, so push() mutates the backing store.
            for (const url of (resultUrls || [])) {
              if (!context.resultUrls.includes(url)) context.resultUrls.push(url);
            }
            for (const url of (videoResultUrls || [])) {
              if (!context.videoResultUrls.includes(url)) context.videoResultUrls.push(url);
            }
          },
          onInsufficientCredits: callbacks.onInsufficientCredits,
          onGallerySaved: callbacks.onGallerySaved,
        };

        return toolRegistry.execute(step.toolName!, args, context, wrappedCallbacks)
          .then((rawResult) => {
            slotResults[i].rawResult = rawResult;

            // Check for fatal errors
            try {
              const parsed = JSON.parse(rawResult);
              if (parsed.error) {
                console.error(`[PIPELINE] Sub-tool error in "${step.label}" invocation ${i}:`, parsed.error);
                if (parsed.error === 'insufficient_credits' || parsed.error === 'no_image') {
                  throw new Error(parsed.error);
                }
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) throw e;
            }
          });
      });

      await Promise.all(promises);
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
            callbacks.onToolProgress({
              ...progress,
              stepLabel,
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
          onGallerySaved: callbacks.onGallerySaved,
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
            console.error(`[PIPELINE] Sub-tool error in "${step.label}" invocation ${i}:`, parsed.error);
            if (parsed.error === 'insufficient_credits' || parsed.error === 'no_image') {
              throw new Error(parsed.error);
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
