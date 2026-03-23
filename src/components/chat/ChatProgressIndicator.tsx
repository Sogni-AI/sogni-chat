/**
 * Progress indicator for tool execution within chat messages.
 * Shows a blurred version of the original photo as background with
 * progress info overlaid. Individual results replace the blur as they arrive.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ToolExecutionProgress } from '@/tools/types';
import { formatCredits } from '@/services/creditsService';
import { useTokenPrice } from '@/hooks/useTokenPrice';
import { activeVideos, pauseOtherVideos, isFullscreenOpen, markAutoPlay, consumeAutoPlay } from './videoCoordination';
import { PersonaReferenceIndicator } from '@/components/personas/PersonaReferenceIndicator';

/** Inline video player for progress grid — hidden until first frame is ready.
 *  Participates in the global video coordination so that playing one video
 *  pauses all others and unmutes the active video (same as ChatVideoPlayer). */
function ProgressVideo({ src, aspectRatio }: { src: string; aspectRatio?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  // Reset loading state when src changes (e.g. retry with different URL)
  useEffect(() => { setReady(false); }, [src]);

  // Register in the global activeVideos set and wire up play coordination
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    activeVideos.add(el);

    const handlePlay = () => {
      if (consumeAutoPlay(el)) {
        // Auto-play: don't interrupt a video the user is already watching.
        for (const v of activeVideos) {
          if (v !== el && !v.paused) {
            el.pause();
            return;
          }
        }
      }
      pauseOtherVideos(el);
      if (el.muted) el.muted = false;
    };
    el.addEventListener('play', handlePlay);

    return () => {
      el.removeEventListener('play', handlePlay);
      activeVideos.delete(el);
    };
  }, []);

  const markReady = useCallback(() => setReady(true), []);

  /** Programmatic auto-play: only plays if no fullscreen viewer is open
   *  and no other inline video is already playing. */
  const handleLoadedData = useCallback(() => {
    setReady(true);
    const el = videoRef.current;
    if (!el) return;
    // Suppress auto-play when the fullscreen viewer is open or another video is already playing
    if (isFullscreenOpen()) return;
    for (const v of activeVideos) {
      if (v !== el && !v.paused) return;
    }
    markAutoPlay(el);
    el.play().catch(() => { /* browser may block autoplay — that's fine */ });
  }, []);

  return (
    <>
      {!ready && (
        <div
          style={{
            aspectRatio: aspectRatio || '16 / 9',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(var(--rgb-primary), 0.06)',
          }}
        >
          <div
            className="animate-spin"
            style={{
              width: '1.25rem',
              height: '1.25rem',
              border: '2.5px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              borderRadius: '50%',
            }}
          />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        loop
        muted
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={markReady}
        onLoadedData={handleLoadedData}
        style={{
          width: '100%',
          height: 'auto',
          display: ready ? 'block' : 'none',
        }}
      />
    </>
  );
}

interface ChatProgressIndicatorProps {
  progress: ToolExecutionProgress;
  /** Original uploaded image URL — shown blurred as placeholder */
  imageUrl?: string | null;
  /** Called when the user clicks the cancel button */
  onCancel?: () => void;
  /** Called when user clicks a completed result in the progress grid */
  onMediaClick?: (index: number, mediaType: 'image' | 'video' | 'audio') => void;
}

const TOOL_LABELS: Record<string, string> = {
  restore_photo: 'Restoring photo',
  apply_style: 'Applying style',
  refine_result: 'Refining result',
  animate_photo: 'Generating video',
  change_angle: 'Generating new angle',
  generate_image: 'Generating image',
  edit_image: 'Editing image',
  generate_video: 'Generating video',
  sound_to_video: 'Creating video from audio',
  video_to_video: 'Transforming video',
  generate_music: 'Generating music',
};

export const ChatProgressIndicator = memo(function ChatProgressIndicator({
  progress,
  imageUrl,
  onCancel,
  onMediaClick,
}: ChatProgressIndicatorProps) {
  const label = progress.stepLabel || TOOL_LABELS[progress.toolName] || 'Processing';
  const percentage = progress.progress ? Math.round(progress.progress * 100) : 0;
  const hasProgress = progress.type === 'progress' && progress.progress !== undefined;
  const hasETA = progress.etaSeconds !== undefined && progress.etaSeconds > 0;
  const { tokenToUSD } = useTokenPrice();
  const isError = progress.type === 'error';

  if (isError) {
    return (
      <div
        style={{
          padding: '0.75rem 1rem',
          background: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius-md)',
          color: '#dc2626',
          fontSize: '0.8125rem',
        }}
      >
        {progress.error || 'Something went wrong'}
      </div>
    );
  }

  const totalCount = progress.totalCount || 1;
  const completedResults = progress.resultUrls || [];
  const isVideoTool = ['animate_photo', 'generate_video', 'sound_to_video', 'video_to_video'].includes(progress.toolName);
  const isBatch = totalCount > 1;
  // Check if any slots are still pending (no result URL and not failed)
  const slotStates = Array.from({ length: totalCount }, (_, i) => {
    const hasResult = !!(completedResults[i] || progress.perJobProgress?.[i]?.resultUrl);
    const hasFailed = !!progress.perJobProgress?.[i]?.error;
    return { hasResult, hasFailed };
  });
  const hasAnyPending = slotStates.some(s => !s.hasResult && !s.hasFailed);
  const failedJobCount = slotStates.filter(s => s.hasFailed).length;

  // Cost label
  const costLabel = progress.estimatedCost !== undefined && progress.estimatedCost > 0
    ? (() => {
        const usd = tokenToUSD(progress.estimatedCost!);
        const usdStr = usd !== null ? ` / ~$${usd.toFixed(2)}` : '';
        return `~${formatCredits(progress.estimatedCost!, true)} credits${usdStr}`;
      })()
    : null;

  // Progress display: prefer ETA when available, otherwise show percentage
  const progressText = hasETA
    ? `~${Math.ceil(progress.etaSeconds!)}s remaining`
    : hasProgress
      ? `${percentage}%`
      : null;

  // Use the source image being processed (if available), otherwise fall back to original
  const placeholderUrl = progress.sourceImageUrl || imageUrl;

  // Show the visual grid when we have a placeholder image, multiple results, or a video tool
  if (placeholderUrl || isBatch || isVideoTool) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        {/* Thumbnail grid — blurred originals with completed results replacing them */}
        <div
          style={{
            display: 'inline-grid',
            gridTemplateColumns: `repeat(${totalCount <= 2 ? totalCount : 2}, minmax(0, 1fr))`,
            gap: '0.5rem',
            maxWidth: totalCount === 1 ? '360px' : '100%',
          }}
        >
          {Array.from({ length: totalCount }, (_, i) => {
            // Use per-job result URL (keyed by job index, always correct).
            // For single jobs, fall back to the accumulated results array.
            // For batches, the accumulated array is ordered by completion time
            // (not slot index), so using it as a positional fallback shows the
            // wrong image in the wrong slot.
            const resultUrl = progress.perJobProgress?.[i]?.resultUrl
              || (totalCount <= 1 ? completedResults[i] : undefined);

            // Per-job progress: only fall back to global for single-job operations
            const jobData = progress.perJobProgress?.[i];
            const jobProg = jobData?.progress ?? (totalCount <= 1 ? progress.progress : undefined);
            const jobPct = jobProg ? Math.round(jobProg * 100) : 0;
            const jobHasProgress = jobProg !== undefined;
            const jobETA = jobData?.etaSeconds ?? (totalCount <= 1 ? progress.etaSeconds : undefined);
            const jobHasETA = jobETA !== undefined && jobETA > 0;
            const jobProgressText = jobHasETA
              ? `~${Math.ceil(jobETA!)}s remaining`
              : jobHasProgress
                ? `${jobPct}%`
                : null;
            const isCompletedVideo = !!resultUrl && isVideoTool;
            const jobError = jobData?.error;

            const isCompleted = !!resultUrl;

            return (
              <div
                key={i}
                onClick={isCompleted && onMediaClick ? () => onMediaClick(i, isVideoTool ? 'video' : 'image') : undefined}
                style={{
                  position: 'relative',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'rgba(var(--rgb-primary), 0.05)',
                  border: '1px solid var(--color-border)',
                  ...(isCompleted && onMediaClick ? { cursor: 'pointer', transition: 'border-color 0.2s ease, transform 0.2s ease' } : {}),
                }}
                onMouseEnter={isCompleted && onMediaClick ? (e) => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                } : undefined}
                onMouseLeave={isCompleted && onMediaClick ? (e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.transform = 'scale(1)';
                } : undefined}
              >
                {/* Completed video result — render inline player */}
                {isCompletedVideo ? (
                  <ProgressVideo src={resultUrl!} aspectRatio={progress.videoAspectRatio} />
                ) : resultUrl || placeholderUrl ? (
                  <img
                    src={resultUrl || placeholderUrl!}
                    alt={resultUrl ? `Result #${i + 1}` : 'Processing...'}
                    style={{
                      width: '100%',
                      display: 'block',
                      filter: resultUrl ? 'none' : 'blur(8px) brightness(0.7)',
                      transform: resultUrl ? 'none' : 'scale(1.05)',
                      transition: 'filter 0.5s ease, transform 0.5s ease',
                      // For video jobs, constrain placeholder to video aspect ratio
                      ...(isVideoTool && !resultUrl && progress.videoAspectRatio
                        ? { aspectRatio: progress.videoAspectRatio, height: 'auto', objectFit: 'cover' as const }
                        : { height: 'auto' }),
                    }}
                  />
                ) : (
                  /* No placeholder image — render a sized placeholder box */
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: progress.videoAspectRatio || '16 / 9',
                      background: 'rgba(var(--rgb-primary), 0.06)',
                    }}
                  />
                )}

                {/* Overlay for failed jobs */}
                {!resultUrl && jobError && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      background: 'rgba(0, 0, 0, 0.6)',
                    }}
                  >
                    {/* Error icon */}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(239, 68, 68, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: 'rgba(239, 68, 68, 0.9)',
                        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                      }}
                    >
                      Failed
                    </span>
                  </div>
                )}

                {/* Overlay for slots still processing — contains spinner + progress info */}
                {!resultUrl && !jobError && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    {/* Spinner */}
                    <div
                      className="animate-spin"
                      style={{
                        width: '1.5rem',
                        height: '1.5rem',
                        border: '2.5px solid rgba(255, 255, 255, 0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                      }}
                    />

                    {/* Label */}
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: '#fff',
                        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                      }}
                    >
                      {label}...
                    </span>

                    {/* Progress or ETA */}
                    {jobProgressText && (
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          color: 'rgba(255,255,255,0.85)',
                          textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                        }}
                      >
                        {jobProgressText}
                      </span>
                    )}

                    {/* Cost — only show on individual overlays for single-item jobs */}
                    {!isBatch && costLabel && (
                      <span
                        style={{
                          fontSize: '0.625rem',
                          color: 'rgba(255,255,255,0.7)',
                          textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                        }}
                      >
                        ({costLabel})
                      </span>
                    )}

                    {/* Progress bar inside overlay */}
                    {jobHasProgress && (
                      <div
                        style={{
                          width: '60%',
                          height: '3px',
                          background: 'rgba(255,255,255,0.2)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${jobPct}%`,
                            height: '100%',
                            background: '#fff',
                            borderRadius: '2px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    )}

                    {/* Cancel button — only show on individual overlays for single-item jobs */}
                    {!isBatch && onCancel && (
                      <button
                        onClick={onCancel}
                        style={{
                          marginTop: '0.375rem',
                          background: 'rgba(255, 255, 255, 0.15)',
                          border: '1px solid rgba(255, 255, 255, 0.3)',
                          color: 'rgba(255, 255, 255, 0.9)',
                          fontSize: '0.625rem',
                          fontWeight: 500,
                          padding: '0.25rem 0.75rem',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Model name label */}
        {progress.modelName && (
          <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
            {progress.modelName}
          </div>
        )}

        {/* Persona reference indicator */}
        {progress.referencedPersonas && progress.referencedPersonas.length > 0 && (
          <PersonaReferenceIndicator personaNames={progress.referencedPersonas} />
        )}

        {/* Batch summary bar — project-level cost + cancel for multi-item jobs */}
        {isBatch && hasAnyPending && (costLabel || onCancel) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {costLabel && (
                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                  Total: {costLabel}
                </span>
              )}
              {progress.completedCount !== undefined && progress.completedCount > 0 && (
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  ({progress.completedCount}/{totalCount} complete{failedJobCount > 0 ? `, ${failedJobCount} failed` : ''})
                </span>
              )}
              {(progress.completedCount ?? 0) === 0 && failedJobCount > 0 && (
                <span style={{ color: 'rgba(239, 68, 68, 0.8)' }}>
                  ({failedJobCount} failed)
                </span>
              )}
            </div>
            {onCancel && (
              <button
                onClick={onCancel}
                aria-label="Cancel all jobs"
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#dc2626',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                }}
              >
                Cancel All
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Fallback: no image URL available — plain progress bar
  // For multi-job operations, compute aggregate progress from per-job data
  const perJob = progress.perJobProgress;
  const aggregateProgress = perJob && totalCount > 1
    ? (() => {
        const values = Object.values(perJob);
        if (values.length === 0) return progress.progress;
        // Completed jobs already have progress=1 from the service
        const sum = values.reduce((acc, j) => acc + (j.progress ?? 0), 0);
        return sum / totalCount;
      })()
    : progress.progress;
  const aggPct = aggregateProgress ? Math.round(aggregateProgress * 100) : 0;
  const aggHasProgress = aggregateProgress !== undefined;
  const aggText = aggHasProgress ? `${aggPct}%` : null;
  // For multi-job, show completed count instead of raw progress
  const flatProgressText = totalCount > 1 && progress.completedCount !== undefined
    ? `${progress.completedCount}/${totalCount} complete${aggText ? ` (${aggText})` : ''}`
    : progressText;
  const flatPercentage = totalCount > 1 ? aggPct : percentage;
  const flatHasProgress = totalCount > 1 ? aggHasProgress : hasProgress;

  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {/* Label row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: flatHasProgress ? '0.5rem' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            className="animate-spin"
            style={{
              width: '0.875rem',
              height: '0.875rem',
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
            }}
          >
            {label}...
          </span>
          {costLabel && (
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                marginLeft: '0.25rem',
              }}
            >
              ({costLabel})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {flatProgressText && (
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              {flatProgressText}
            </span>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              aria-label="Cancel"
              style={{
                background: 'rgba(0, 0, 0, 0.08)',
                border: 'none',
                color: 'var(--color-text-secondary)',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                e.currentTarget.style.color = '#dc2626';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.08)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {flatHasProgress && (
        <div
          style={{
            width: '100%',
            height: '4px',
            background: 'rgba(var(--rgb-primary), 0.1)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${flatPercentage}%`,
              height: '100%',
              background: 'var(--sogni-gradient)',
              borderRadius: '2px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* Model name label */}
      {progress.modelName && (
        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', marginTop: '0.375rem', opacity: 0.6 }}>
          {progress.modelName}
        </div>
      )}

      {/* Persona reference indicator */}
      {progress.referencedPersonas && progress.referencedPersonas.length > 0 && (
        <PersonaReferenceIndicator personaNames={progress.referencedPersonas} />
      )}
    </div>
  );
});
