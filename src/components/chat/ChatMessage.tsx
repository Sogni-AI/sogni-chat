/**
 * Individual chat message component.
 * Renders user messages, assistant messages (with streaming indicator),
 * system notifications, inline image results, and tool execution progress.
 */
import { memo } from 'react';
import type { UIChatMessage } from '@/hooks/useChat';
import { ChatImageResults } from './ChatImageResults';
import { ChatVideoResults } from './ChatVideoResults';
import ChatAudioResults from './ChatAudioResults';
import { ChatProgressIndicator } from './ChatProgressIndicator';

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

  // Don't render empty assistant messages (streaming placeholder before tool call)
  if (isAssistant && !hasVisibleContent && !hasProgress && !hasImages && !hasVideos && !hasAudios && message.isStreaming) {
    return null;
  }

  // User's uploaded image (shown as a right-aligned thumbnail)
  if (isUser && hasUploadedImage && !hasVisibleContent) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          maxWidth: '100%',
        }}
      >
        <div
          style={{
            maxWidth: '280px',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)',
          }}
        >
          <img
            src={message.uploadedImageUrl}
            alt="Uploaded photo"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>
      </div>
    );
  }

  // System notification (e.g. context trimmed)
  if (isSystem && hasVisibleContent) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '0.25rem 0',
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-muted, #999)',
            fontStyle: 'italic',
          }}
        >
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
      {hasVisibleContent && (
        <div
          style={{
            maxWidth: isUser ? '75%' : '85%',
            padding: '0.75rem 1rem',
            borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
            background: isUser
              ? 'var(--sogni-gradient)'
              : 'var(--color-bg-elevated)',
            color: isUser ? '#fff' : 'var(--color-text-primary)',
            border: isUser ? 'none' : '1px solid var(--color-border)',
            fontSize: '0.875rem',
            lineHeight: '1.5',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            boxShadow: isUser
              ? '0 2px 8px rgba(var(--rgb-primary), 0.2)'
              : '0 1px 4px rgba(0,0,0,0.04)',
          }}
        >
          {message.content.trim()}
          {isAssistant && message.isStreaming && !message.toolProgress && (
            <span
              style={{
                display: 'inline-block',
                width: '0.5rem',
                height: '1rem',
                marginLeft: '0.125rem',
                background: 'var(--color-accent)',
                borderRadius: '1px',
                animation: 'chatCursorBlink 1s ease-in-out infinite',
                verticalAlign: 'text-bottom',
              }}
            />
          )}
        </div>
      )}

      {/* Model refusal — switch confirmation */}
      {message.modelRefusal && onAcceptModelSwitch && (
        <div
          style={{
            maxWidth: '85%',
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            fontSize: '0.8125rem',
            lineHeight: '1.5',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <span style={{ color: 'var(--color-text-secondary)' }}>
            The model declined this request. Switch to unrestricted mode?
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={onAcceptModelSwitch}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: 'var(--sogni-gradient)',
                color: '#fff',
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
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
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

      {/* Video results — suppressed while toolProgress is active to avoid duplication with ProgressVideo */}
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
