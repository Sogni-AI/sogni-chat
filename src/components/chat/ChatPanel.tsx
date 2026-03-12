/**
 * Full-width chat panel for the chat restoration mode.
 * Renders message history, handles auto-scroll, and manages input.
 * State is owned by the parent (ChatPage) and passed in as props.
 */
import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { SogniClient } from '@sogni-ai/sogni-client';
import type { TokenType, Balances } from '@/types/wallet';
import type { UseChatResult } from '@/hooks/useChat';
import type { UploadedFile } from '@/tools/types';
import { QUALITY_PRESETS } from '@/config/qualityPresets';
import { generateSuggestions } from '@/utils/chatSuggestions';
import { FullscreenBeforeAfter } from '@/components/FullscreenBeforeAfter';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SuggestionChips } from './SuggestionChips';
import { ChatAnalysisIndicator } from './ChatAnalysisIndicator';
import { FileDropZone } from './FileDropZone';
import { IntentCaptureCard } from './IntentCaptureCard';

interface ChatPanelProps {
  sogniClient: SogniClient | null;
  imageData: Uint8Array | null;
  imageUrl: string | null;
  width: number;
  height: number;
  tokenType: TokenType;
  balances: Balances | null;
  isAuthenticated: boolean;
  chat: UseChatResult;
  qualityTier: 'fast' | 'hq';
  onQualityTierChange: (tier: 'fast' | 'hq') => void;
  estimatedCost?: number | null;
  costLoading?: boolean;
  /** When false, suppress auto-analysis trigger (e.g. during session restore) */
  allowAutoAnalysis?: boolean;
  onResultsChange?: (urls: string[]) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onUploadClick?: () => void;
  onTokenSwitch?: (newType: TokenType) => void;
  onInsufficientCredits?: () => void;
  /** Called when user clicks "Clear Chat" — parent should clear image + results */
  onClearAll?: () => void;
  /** When provided, renders a hamburger menu button in the header (mobile drawer trigger) */
  onOpenDrawer?: () => void;
  /** Descriptive slug for download filenames (e.g. slugified session title) */
  downloadSlug?: string;
  /** Files uploaded via the media attachment button */
  uploadedFiles?: UploadedFile[];
  /** True while a media file is being read/processed */
  isMediaUploading?: boolean;
  /** Last media upload validation or processing error */
  mediaUploadError?: string | null;
  /** Add a media file (audio, video, or extra image) */
  onAddMediaFile?: (file: File) => Promise<void>;
  /** Remove a media file by index */
  onRemoveMediaFile?: (index: number) => void;
  /** Clear all media files */
  onClearMediaFiles?: () => void;
  /** Called when a file is dropped onto the chat panel (drag-and-drop) */
  onFileDrop?: (file: File) => void;
}

export function ChatPanel({
  sogniClient,
  imageData,
  imageUrl,
  width,
  height,
  tokenType,
  balances,
  isAuthenticated,
  chat,
  qualityTier,
  onQualityTierChange,
  estimatedCost,
  costLoading,
  allowAutoAnalysis = true,
  onResultsChange,
  onLoadingChange,
  onUploadClick,
  onTokenSwitch,
  onInsufficientCredits,
  onClearAll,
  onOpenDrawer,
  downloadSlug,
  uploadedFiles,
  isMediaUploading,
  mediaUploadError,
  onAddMediaFile,
  onRemoveMediaFile,
  onClearMediaFiles,
  onFileDrop,
}: ChatPanelProps) {
  const {
    messages,
    isLoading,
    isAnalyzing,
    error,
    allResultUrls,
    analysisSuggestions,
    sendMessage,
    analyzeImage,
    reset,
  } = chat;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevResultCountRef = useRef(0);
  const prevMessageCountRef = useRef(messages.length);
  const isUserNearBottomRef = useRef(true);
  const analysisTriggeredRef = useRef(false);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  // Auto-trigger vision analysis when image is available and chat is at welcome state.
  // Gated on allowAutoAnalysis to prevent firing during session restoration.
  useEffect(() => {
    if (
      allowAutoAnalysis &&
      imageData &&
      imageUrl &&
      sogniClient &&
      !isLoading &&
      !analysisTriggeredRef.current &&
      messages.length === 1 &&
      messages[0].id === 'welcome'
    ) {
      analysisTriggeredRef.current = true;
      analyzeImage({
        sogniClient,
        imageUrl,
        tokenType,
        balances,
        onTokenSwitch,
        onInsufficientCredits,
      });
    }
  }, [allowAutoAnalysis, imageData, imageUrl, sogniClient, isLoading, messages, tokenType, balances, onTokenSwitch, onInsufficientCredits, analyzeImage]);

  // Reset analysis trigger when chat is reset (messages go back to welcome)
  useEffect(() => {
    if (messages.length === 1 && messages[0].id === 'welcome') {
      analysisTriggeredRef.current = false;
    }
  }, [messages]);

  const suggestions = useMemo(
    () => (isLoading ? [] : generateSuggestions(messages, analysisSuggestions, !!imageData)),
    [messages, isLoading, analysisSuggestions, imageData],
  );

  // Smart auto-scroll: scroll to bottom when new messages arrive, during streaming,
  // or when suggestion chips appear — but only when user is already near the bottom.
  useEffect(() => {
    if (!isUserNearBottomRef.current) return;

    const isNewMessage = messages.length !== prevMessageCountRef.current;
    const hasStreamingMessage = messages.some((m) => m.isStreaming);

    if (isNewMessage || hasStreamingMessage || suggestions.length > 0) {
      prevMessageCountRef.current = messages.length;
      messagesEndRef.current?.scrollIntoView({ behavior: isNewMessage ? 'smooth' : 'instant' });
    }
  }, [messages, suggestions]);

  // ResizeObserver-based auto-scroll: when content grows (image loads, progress→results swap),
  // keep the view pinned to the bottom. This catches height changes that don't trigger
  // React state updates (e.g. image onload expanding the DOM).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let prevHeight = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const newHeight = container.scrollHeight;
      if (newHeight > prevHeight && isUserNearBottomRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      prevHeight = newHeight;
    });
    // Observe the scroll container itself — fires when children resize (images load, etc.)
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Track user scroll position to decide if auto-scroll should fire
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isUserNearBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  }, []);

  // Notify parent of loading state changes
  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Notify parent of new results
  useEffect(() => {
    if (allResultUrls.length !== prevResultCountRef.current) {
      prevResultCountRef.current = allResultUrls.length;
      onResultsChange?.(allResultUrls);
    }
  }, [allResultUrls, onResultsChange]);

  const handleSend = useCallback(
    (content: string) => {
      if (!sogniClient || !imageData) return;
      sendMessage(content, {
        sogniClient,
        imageData,
        width,
        height,
        tokenType,
        balances,
        qualityTier,
        uploadedFiles,
        onTokenSwitch,
        onInsufficientCredits,
      });
      // Clear attached files after sending so they don't carry over to the next message
      onClearMediaFiles?.();
    },
    [sogniClient, imageData, width, height, tokenType, balances, qualityTier, uploadedFiles, onTokenSwitch, onInsufficientCredits, sendMessage, onClearMediaFiles],
  );

  const handleImageClick = useCallback((url: string, _index: number) => {
    const globalIndex = allResultUrls.indexOf(url);
    setFullscreenIndex(globalIndex >= 0 ? globalIndex : 0);
  }, [allResultUrls]);

  // Inject current imageUrl into the user-upload message (blob URLs don't survive page refresh)
  const processedMessages = useMemo(() => {
    if (!imageUrl) return messages;
    return messages.map((msg) =>
      msg.id === 'user-upload' ? { ...msg, uploadedImageUrl: imageUrl } : msg,
    );
  }, [messages, imageUrl]);

  const galleryItems = useMemo(
    () => allResultUrls.map((url) => ({ before: imageUrl || '', after: url })),
    [allResultUrls, imageUrl],
  );

  // Collect all gallery image IDs across messages (parallel to allResultUrls)
  const allGalleryImageIds = useMemo(() => {
    const ids: string[] = [];
    for (const msg of messages) {
      if (msg.imageResults && msg.galleryImageIds) {
        ids.push(...msg.galleryImageIds);
      }
    }
    return ids;
  }, [messages]);

  const hasImage = !!imageData && !!imageUrl;
  const canSend = isAuthenticated && hasImage && !!sogniClient;

  // Show the intent capture card after analysis completes, before user sends first message
  const showIntentCapture = useMemo(() => {
    if (!hasImage || isLoading || isAnalyzing) return false;
    // Check that no user text messages exist (only welcome + analysis messages)
    const hasUserTextMessage = messages.some(
      (m) => m.role === 'user' && m.id !== 'user-upload' && m.content?.trim(),
    );
    return !hasUserTextMessage;
  }, [hasImage, isLoading, isAnalyzing, messages]);

  return (
    <FileDropZone
      onFileDrop={onFileDrop!}
      accept="image/*"
      disabled={!onFileDrop}
      style={{ height: '100%' }}
    >
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        className="chat-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-elevated)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Mobile drawer toggle */}
          {onOpenDrawer && (
            <button
              onClick={onOpenDrawer}
              aria-label="Open chat history"
              style={{
                width: '2rem',
                height: '2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(var(--rgb-primary), 0.06)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: 'var(--color-text-primary)',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <div
            style={{
              width: '1.75rem',
              height: '1.75rem',
              borderRadius: '50%',
              background: 'var(--sogni-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-display)',
            }}
          >
            AI Assistant
          </span>
        </div>

        <div className="chat-panel-quality" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Quality toggle */}
          <span className="chat-quality-label" style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            Image Quality:
          </span>
          <div style={{
            display: 'inline-flex',
            borderRadius: '0.375rem',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}>
            {(['fast', 'hq'] as const).map((tier) => {
              const isSelected = qualityTier === tier;
              const showCost = isSelected && estimatedCost != null && !costLoading;
              return (
              <button
                key={tier}
                type="button"
                onClick={() => onQualityTierChange(tier)}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.6875rem',
                  fontWeight: isSelected ? 600 : 400,
                  background: isSelected ? 'var(--sogni-gradient-subtle)' : 'transparent',
                  color: isSelected ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                  border: 'none',
                  borderRight: tier === 'fast' ? '1px solid var(--color-border)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                title={QUALITY_PRESETS[tier].description}
              >
                {QUALITY_PRESETS[tier].label}{showCost ? `: ~${estimatedCost.toFixed(1)} credits` : ''}
              </button>
              );
            })}
          </div>

        {messages.length > 1 && (
          <button
            onClick={onClearAll || (() => reset())}
            title="Clear conversation and start fresh"
            style={{
              padding: '0.25rem 0.5rem',
              fontSize: '0.6875rem',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              background: 'rgba(var(--rgb-primary), 0.05)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(var(--rgb-primary), 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(var(--rgb-primary), 0.05)';
            }}
          >
            Clear Chat
          </button>
        )}
        </div>
      </div>

      {/* Upload prompt when no image */}
      {!hasImage && (
        <button
          onClick={onUploadClick}
          className="radiant-orb-hover"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem 1rem',
            textAlign: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.2s',
            minHeight: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(var(--rgb-primary), 0.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
          }}
          aria-label="Upload a photo"
        >
          <div className="radiant-orb-wrapper" style={{ width: '80px', height: '80px', marginBottom: '0.75rem' }}>
            <div className="sparkle-dot" />
            <div className="sparkle-dot" />
            <div className="sparkle-dot" />
            <div className="sparkle-dot" />
            <div className="sparkle-dot" />
            <div className="sparkle-dot" />
            <div className="orb-icon" style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: 'var(--sogni-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          </div>
          <p style={{
            color: 'var(--color-text-primary)',
            fontSize: '0.9375rem',
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
            marginBottom: '0.25rem',
            letterSpacing: '-0.01em',
          }}>
            Upload a Photo to Get Started
          </p>
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem', lineHeight: '1.4' }}>
            Tap here, drag &amp; drop, or use the button above
          </p>
        </button>
      )}

      {/* Messages */}
      {hasImage && (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {processedMessages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              imageUrl={imageUrl}
              onImageClick={handleImageClick}
              onCancelTool={msg.toolProgress ? chat.cancelToolExecution : undefined}
              onAcceptModelSwitch={msg.modelRefusal ? chat.acceptModelSwitch : undefined}
              onDeclineModelSwitch={msg.modelRefusal ? chat.declineModelSwitch : undefined}
              downloadSlug={downloadSlug}
            />
          ))}

          {/* Analysis loading indicator (shown after image, before first tokens arrive) */}
          {isAnalyzing && <ChatAnalysisIndicator />}

          {/* Intent capture card — guided damage selection after analysis, before first user message */}
          {showIntentCapture && canSend && (
            <IntentCaptureCard onSubmit={handleSend} disabled={isLoading} />
          )}

          {/* Suggestion chips */}
          {canSend && suggestions.length > 0 && (
            <SuggestionChips suggestions={suggestions} onSelect={handleSend} />
          )}

          {/* Error display */}
          {(error || mediaUploadError) && (
            <div
              style={{
                padding: '0.625rem 0.875rem',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 'var(--radius-md)',
                color: '#dc2626',
                fontSize: '0.8125rem',
              }}
            >
              {error || mediaUploadError}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!canSend}
        placeholder={
          !hasImage
            ? 'Upload a photo first...'
            : 'Describe what you want done with your photo...'
        }
        uploadedFiles={uploadedFiles}
        isMediaUploading={isMediaUploading}
        onAddMediaFile={onAddMediaFile}
        onRemoveMediaFile={onRemoveMediaFile}
      />

      {/* Fullscreen before/after viewer */}
      {fullscreenIndex !== null && galleryItems.length > 0 && (
        <FullscreenBeforeAfter
          items={galleryItems}
          currentIndex={fullscreenIndex}
          onClose={() => setFullscreenIndex(null)}
          onNavigate={setFullscreenIndex}
          downloadSlug={downloadSlug}
          galleryImageIds={allGalleryImageIds}
        />
      )}
    </div>
    </FileDropZone>
  );
}
