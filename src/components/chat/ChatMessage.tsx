/**
 * Individual chat message component — ChatGPT-inspired dark theme.
 * Renders user messages, assistant messages (with streaming indicator),
 * system notifications, inline image results, and tool execution progress.
 */
import { memo, useState, useCallback } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { UIChatMessage } from '@/hooks/useChat';
import { ChatImageResults } from './ChatImageResults';
import { ChatVideoResults } from './ChatVideoResults';
import ChatAudioResults from './ChatAudioResults';
import { ChatProgressIndicator } from './ChatProgressIndicator';
import { SogniTVOffer } from './SogniTVOffer';
import { LazyMedia } from './LazyMedia';
import { MediaActionsMenu } from './MediaActionsMenu';
import './chat.css';

/** Shared ReactMarkdown component overrides — hoisted to avoid re-creation per render */
const markdownComponents: Components = {
  p: ({ children }) => <span className="chat-md-p" style={{ display: 'block' }}>{children}</span>,
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  ol: ({ children }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>,
  ul: ({ children }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>,
  li: ({ children }) => <li style={{ marginBottom: '0.25em' }}>{children}</li>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>{children}</a>,
  pre: ({ children }) => <pre style={{ background: 'rgba(255,255,255,0.06)', padding: '0.75em 1em', borderRadius: '6px', overflowX: 'auto', margin: '0.5em 0', fontSize: '0.875em' }}>{children}</pre>,
  code: ({ children }) => <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.125em 0.375em', borderRadius: '4px', fontSize: '0.875em' }}>{children}</code>,
};

interface ChatMessageProps {
  message: UIChatMessage;
  /** Original uploaded image URL — used for blurred progress placeholder */
  imageUrl?: string | null;
  onImageClick?: (url: string, index: number) => void;
  /** Called when the user cancels an in-progress tool execution */
  onCancelTool?: () => void;
  /** Called when user accepts switching to unrestricted model */
  onAcceptModelSwitch?: () => void;
  /** Called when user declines switching to unrestricted model */
  onDeclineModelSwitch?: () => void;
  /** Descriptive slug for download filenames (e.g. from session title) */
  downloadSlug?: string;
  /** Called when user clicks "Branch in new chat" from media actions menu */
  onBranchChat?: (message: UIChatMessage) => void;
  /** Called when user clicks "Try again" or selects a model from media actions menu */
  onRetry?: (message: UIChatMessage, modelKey?: string) => void;
}

export const ChatMessage = memo(function ChatMessage({ message, imageUrl, onImageClick, onCancelTool, onAcceptModelSwitch, onDeclineModelSwitch, downloadSlug, onBranchChat, onRetry }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';

  // Safety net: strip any leaked LLM XML blocks (<think>, <tool_call>) from
  // assistant content. The streaming layer strips these in real-time, but this
  // catches edge cases where partial tags or race conditions let XML through.
  const displayContent = isAssistant
    ? message.content
        .replace(/<(?:tool_call|think)>[\s\S]*?<\/(?:tool_call|think)>/g, '')
        .replace(/<(?:tool_call|think)>[\s\S]*$/g, '')
        .trim()
    : message.content;

  const hasVisibleContent = displayContent?.trim();
  const hasProgress = !!message.toolProgress;
  const hasImages = message.imageResults && message.imageResults.length > 0;
  const hasVideos = message.videoResults && message.videoResults.length > 0;
  const hasAudios = message.audioResults && message.audioResults.length > 0;
  const hasUploadedImage = !!message.uploadedImageUrl;
  const hasUploadedImages = message.uploadedImageUrls && message.uploadedImageUrls.length > 0;

  // Track which video/audio is currently active (for "Save current" in menu)
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [activeAudioIndex, setActiveAudioIndex] = useState(0);
  const handleVideoIndexChange = useCallback((i: number) => setActiveVideoIndex(i), []);
  const handleAudioIndexChange = useCallback((i: number) => setActiveAudioIndex(i), []);

  // Don't render empty assistant messages (but keep streaming ones visible for the cursor)
  if (isAssistant && !hasVisibleContent && !hasProgress && !hasImages && !hasVideos && !hasAudios && !message.isStreaming) {
    return null;
  }

  // User's uploaded images (multiple)
  if (isUser && hasUploadedImages && !hasVisibleContent) {
    const urls = message.uploadedImageUrls!;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', maxWidth: '100%' }}>
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}>
          {urls.map((url, i) => (
            <div key={i} style={{
              maxWidth: urls.length === 1 ? '280px' : '200px',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}>
              <img src={url} alt={`Uploaded photo${urls.length > 1 ? ` ${i + 1}` : ''}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // User's uploaded image (legacy single-image)
  if (isUser && hasUploadedImage && !hasVisibleContent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', maxWidth: '100%' }}>
        <div style={{
          maxWidth: '280px',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          <img src={message.uploadedImageUrl} alt="Uploaded photo" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </div>
      </div>
    );
  }

  // System notification
  if (isSystem && hasVisibleContent) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0.25rem 0' }}>
        <span style={{ fontSize: '0.75rem', color: '#666666', fontStyle: 'italic' }}>
          {displayContent.trim()}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: '0.375rem',
        maxWidth: '100%',
      }}
    >
      {/* Message bubble */}
      {(hasVisibleContent || (isAssistant && message.isStreaming && !hasProgress)) && (
        <div
          style={{
            maxWidth: isUser ? '75%' : '85%',
            padding: '0.75rem 1rem',
            borderRadius: isUser ? '1.25rem 1.25rem 0.25rem 1.25rem' : '1.25rem 1.25rem 1.25rem 0.25rem',
            background: isUser ? '#2f2f2f' : 'transparent',
            color: '#ececec',
            fontSize: '0.9375rem',
            lineHeight: '1.6',
            wordBreak: 'break-word',
            whiteSpace: isUser ? 'pre-wrap' : undefined,
          }}
        >
          {isAssistant ? (
            <>
              {hasVisibleContent && (
                <ReactMarkdown components={markdownComponents}>
                  {displayContent}
                </ReactMarkdown>
              )}
              {message.isStreaming && !message.toolProgress && (
                hasVisibleContent ? (
                  <span className="chat-streaming-cursor" />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div
                      className="animate-spin"
                      style={{
                        width: '0.75rem',
                        height: '0.75rem',
                        border: '2px solid rgba(142, 142, 142, 0.3)',
                        borderTopColor: '#8e8e8e',
                        borderRadius: '50%',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: '0.8125rem', color: '#8e8e8e' }}>
                      {message.streamingStatus || 'Thinking...'}
                    </span>
                  </div>
                )
              )}
            </>
          ) : (
            <>
              {displayContent.trim()}
              {message.isStreaming && !message.toolProgress && (
                <span className="chat-streaming-cursor" />
              )}
            </>
          )}
        </div>
      )}

      {/* Chat model label during streaming */}
      {isAssistant && message.isStreaming && message.chatModelLabel && (
        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
          {message.chatModelLabel}
        </div>
      )}

      {/* Model refusal — switch confirmation */}
      {message.modelRefusal && onAcceptModelSwitch && (
        <div
          style={{
            maxWidth: '85%',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-lg)',
            background: '#2f2f2f',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: '0.875rem',
            lineHeight: '1.5',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <span style={{ color: '#b4b4b4' }}>
            The model declined this request. Switch to unrestricted mode?
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={onAcceptModelSwitch}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 'var(--radius-pill)',
                border: 'none',
                background: '#ffffff',
                color: '#0a0a0a',
                fontSize: '0.8125rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Switch
            </button>
            <button
              onClick={onDeclineModelSwitch}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'transparent',
                color: '#b4b4b4',
                fontSize: '0.8125rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Tool execution progress */}
      {message.toolProgress && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <ChatProgressIndicator progress={message.toolProgress} imageUrl={imageUrl} onCancel={onCancelTool} />
          <SogniTVOffer executionId={message.id} etaSeconds={message.toolProgress?.etaSeconds} />
        </div>
      )}

      {/* Image results */}
      {message.imageResults && message.imageResults.length > 0 && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <LazyMedia enabled={!!message.isFromHistory} placeholderHeight={200}>
            <ChatImageResults
              urls={message.imageResults}
              sourceImageUrl={message.sourceImageUrl || imageUrl || undefined}
              onImageClick={onImageClick}
              galleryImageIds={message.galleryImageIds}
            />
          </LazyMedia>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem' }}>
            <MediaActionsMenu
              message={message}
              onBranchChat={onBranchChat}
              onRetry={onRetry}
              mediaType="image"
              mediaUrls={message.imageResults}
              galleryImageIds={message.galleryImageIds}
              downloadSlug={downloadSlug}
            />
            {message.modelName && (
              <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
                {message.modelName}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video results — no LazyMedia wrapper since videos lack thumbnails;
           the player has its own loading spinner and gallery blobs are local */}
      {message.videoResults && message.videoResults.length > 0 && !message.toolProgress && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <ChatVideoResults urls={message.videoResults} galleryVideoIds={message.galleryVideoIds} videoAspectRatio={message.videoAspectRatio} autoPlay={!message.isFromHistory} onActiveIndexChange={handleVideoIndexChange} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem' }}>
            <MediaActionsMenu
              message={message}
              onBranchChat={onBranchChat}
              onRetry={onRetry}
              mediaType="video"
              mediaUrls={message.videoResults}
              galleryVideoIds={message.galleryVideoIds}
              downloadSlug={downloadSlug}
              activeMediaIndex={activeVideoIndex}
            />
            {message.modelName && (
              <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
                {message.modelName}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audio results */}
      {message.audioResults && message.audioResults.length > 0 && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <LazyMedia enabled={!!message.isFromHistory} placeholderHeight={80}>
            <ChatAudioResults audioUrls={message.audioResults} onActiveIndexChange={handleAudioIndexChange} />
          </LazyMedia>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem' }}>
            <MediaActionsMenu
              message={message}
              onBranchChat={onBranchChat}
              onRetry={onRetry}
              mediaType="audio"
              mediaUrls={message.audioResults}
              downloadSlug={downloadSlug}
              activeMediaIndex={activeAudioIndex}
            />
            {message.modelName && (
              <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
                {message.modelName}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
