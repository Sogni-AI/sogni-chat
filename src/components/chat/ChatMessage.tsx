/**
 * Individual chat message component — ChatGPT-inspired dark theme.
 * Renders user messages, assistant messages (with streaming indicator),
 * system notifications, inline image results, and tool execution progress.
 */
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UIChatMessage } from '@/hooks/useChat';
import { ChatImageResults } from './ChatImageResults';
import { ChatVideoResults } from './ChatVideoResults';
import ChatAudioResults from './ChatAudioResults';
import { ChatProgressIndicator } from './ChatProgressIndicator';
import { SogniTVOffer } from './SogniTVOffer';
import './chat.css';

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
}

export const ChatMessage = memo(function ChatMessage({ message, imageUrl, onImageClick, onCancelTool, onAcceptModelSwitch, onDeclineModelSwitch, downloadSlug }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';

  const hasVisibleContent = message.content?.trim();
  const hasProgress = !!message.toolProgress;
  const hasImages = message.imageResults && message.imageResults.length > 0;
  const hasVideos = message.videoResults && message.videoResults.length > 0;
  const hasAudios = message.audioResults && message.audioResults.length > 0;
  const hasUploadedImage = !!message.uploadedImageUrl;

  // Don't render empty assistant messages (but keep streaming ones visible for the cursor)
  if (isAssistant && !hasVisibleContent && !hasProgress && !hasImages && !hasVideos && !hasAudios && !message.isStreaming) {
    return null;
  }

  // User's uploaded image
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
          {message.content.trim()}
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
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <span className="chat-md-p" style={{ display: 'block' }}>{children}</span>,
                    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                    ol: ({ children }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>,
                    ul: ({ children }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>,
                    li: ({ children }) => <li style={{ marginBottom: '0.25em' }}>{children}</li>,
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>{children}</a>,
                    pre: ({ children }) => <pre style={{ background: 'rgba(255,255,255,0.06)', padding: '0.75em 1em', borderRadius: '6px', overflowX: 'auto', margin: '0.5em 0', fontSize: '0.875em' }}>{children}</pre>,
                    code: ({ children }) => <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.125em 0.375em', borderRadius: '4px', fontSize: '0.875em' }}>{children}</code>,
                  }}
                >
                  {message.content.trim()}
                </ReactMarkdown>
              )}
              {message.isStreaming && !message.toolProgress && (
                <span className="chat-streaming-cursor" />
              )}
            </>
          ) : (
            <>
              {message.content.trim()}
              {message.isStreaming && !message.toolProgress && (
                <span className="chat-streaming-cursor" />
              )}
            </>
          )}
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
          <ChatImageResults
            urls={message.imageResults}
            sourceImageUrl={message.sourceImageUrl || imageUrl || undefined}
            onImageClick={onImageClick}
            galleryImageIds={message.galleryImageIds}
          />
        </div>
      )}

      {/* Video results */}
      {message.videoResults && message.videoResults.length > 0 && !message.toolProgress && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <ChatVideoResults urls={message.videoResults} galleryVideoIds={message.galleryVideoIds} downloadSlug={downloadSlug} videoAspectRatio={message.videoAspectRatio} />
        </div>
      )}

      {/* Audio results */}
      {message.audioResults && message.audioResults.length > 0 && (
        <div style={{ maxWidth: '85%', width: '100%' }}>
          <ChatAudioResults audioUrls={message.audioResults} />
        </div>
      )}
    </div>
  );
});
