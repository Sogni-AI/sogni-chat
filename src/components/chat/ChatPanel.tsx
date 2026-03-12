/**
 * Full-width chat panel — ChatGPT-inspired dark design.
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

  // Reset analysis trigger when chat is reset
  useEffect(() => {
    if (messages.length === 1 && messages[0].id === 'welcome') {
      analysisTriggeredRef.current = false;
    }
  }, [messages]);

  const suggestions = useMemo(
    () => (isLoading ? [] : generateSuggestions(messages, analysisSuggestions, !!imageData)),
    [messages, isLoading, analysisSuggestions, imageData],
  );

  // Smart auto-scroll
  useEffect(() => {
    if (!isUserNearBottomRef.current) return;
    const isNewMessage = messages.length !== prevMessageCountRef.current;
    const hasStreamingMessage = messages.some((m) => m.isStreaming);
    if (isNewMessage || hasStreamingMessage || suggestions.length > 0) {
      prevMessageCountRef.current = messages.length;
      messagesEndRef.current?.scrollIntoView({ behavior: isNewMessage ? 'smooth' : 'instant' });
    }
  }, [messages, suggestions]);

  // ResizeObserver-based auto-scroll
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
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isUserNearBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  }, []);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    if (allResultUrls.length !== prevResultCountRef.current) {
      prevResultCountRef.current = allResultUrls.length;
      onResultsChange?.(allResultUrls);
    }
  }, [allResultUrls, onResultsChange]);

  const handleSend = useCallback(
    (content: string) => {
      if (!sogniClient) return;
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
      onClearMediaFiles?.();
    },
    [sogniClient, imageData, width, height, tokenType, balances, qualityTier, uploadedFiles, onTokenSwitch, onInsufficientCredits, sendMessage, onClearMediaFiles],
  );

  const handleImageClick = useCallback((url: string, _index: number) => {
    const globalIndex = allResultUrls.indexOf(url);
    setFullscreenIndex(globalIndex >= 0 ? globalIndex : 0);
  }, [allResultUrls]);

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
  const canSend = isAuthenticated && !!sogniClient;

  // True when the welcome empty state UI is showing (has its own category chips)
  const showWelcomeScreen = !hasImage && messages.length <= 1 && messages[0]?.id === 'welcome' && !isLoading;

  const showIntentCapture = useMemo(() => {
    if (!hasImage || isLoading || isAnalyzing) return false;
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
        background: '#212121',
        overflow: 'hidden',
      }}
    >
      {/* Minimal top bar — hamburger (mobile) + quality toggle + clear */}
      <div
        className="chat-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 1rem',
          flexShrink: 0,
          borderBottom: (hasImage || messages.length > 1) ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
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
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: '#b4b4b4',
                flexShrink: 0,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#b4b4b4'; }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="chat-panel-quality" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(hasImage || messages.length > 1) && (
            <>
              <span className="chat-quality-label" style={{ fontSize: '0.75rem', color: '#8e8e8e', fontWeight: 500 }}>
                Quality:
              </span>
              <div style={{
                display: 'inline-flex',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
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
                      padding: '0.25rem 0.625rem',
                      fontSize: '0.75rem',
                      fontWeight: isSelected ? 600 : 400,
                      background: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                      color: isSelected ? '#ececec' : '#8e8e8e',
                      border: 'none',
                      borderRight: tier === 'fast' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title={QUALITY_PRESETS[tier].description}
                  >
                    {QUALITY_PRESETS[tier].label}{showCost ? `: ~${estimatedCost.toFixed(1)}` : ''}
                  </button>
                  );
                })}
              </div>

              {messages.length > 1 && (
                <button
                  onClick={onClearAll || (() => reset())}
                  title="Clear conversation and start fresh"
                  style={{
                    padding: '0.25rem 0.625rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: '#8e8e8e',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 'var(--radius-lg)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ececec';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#8e8e8e';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  }}
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Messages area — always visible */}
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
        <div style={{ maxWidth: '48rem', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
          {/* Empty state — welcome screen with category chips */}
          {showWelcomeScreen && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem 0',
                textAlign: 'center',
              }}
            >
              <h1
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 600,
                  color: '#ececec',
                  letterSpacing: '-0.02em',
                  marginBottom: '2rem',
                }}
              >
                What would you like to create?
              </h1>

              {/* Category chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', marginBottom: '2rem' }}>
                {[
                  { label: 'Generate an image', prompt: 'Generate an image of a magical forest with bioluminescent mushrooms, soft fog, and moonlight filtering through ancient trees', icon: 'image' },
                  { label: 'Create a video', prompt: 'Generate a video of a cozy cafe on a rainy night, raindrops on the window, warm light inside, gentle camera push-in', icon: 'video' },
                  { label: 'Compose music', prompt: 'Generate a dreamy indie pop track, 110 BPM, with reverb-heavy guitars, soft vocals, and atmospheric synth pads', icon: 'music' },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => handleSend(chip.prompt)}
                    disabled={!canSend}
                    className="radiant-orb-hover"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.625rem 1.25rem',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 'var(--radius-pill)',
                      cursor: canSend ? 'pointer' : 'default',
                      color: '#ececec',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                      opacity: canSend ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => {
                      if (!canSend) return;
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                    }}
                  >
                    {chip.icon === 'image' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    )}
                    {chip.icon === 'video' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                    {chip.icon === 'music' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    )}
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Upload row */}
              <button
                onClick={onUploadClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 'var(--radius-pill)',
                  cursor: 'pointer',
                  color: '#8e8e8e',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ececec';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8e8e8e';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                }}
                aria-label="Upload a photo to edit"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Upload a photo to edit
              </button>

              <p style={{ color: '#555555', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                or drag &amp; drop a file anywhere
              </p>
            </div>
          )}

          {/* Chat messages — skip welcome message when in no-image empty state */}
          {processedMessages.map((msg) => {
            // Hide the welcome sentinel message when the empty state UI is showing
            // Always hide the welcome sentinel — it's only used to detect the empty state,
            // never displayed as an actual chat bubble.
            if (msg.id === 'welcome') return null;
            return (
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
            );
          })}

          {isAnalyzing && <ChatAnalysisIndicator />}

          {showIntentCapture && canSend && (
            <IntentCaptureCard onSubmit={handleSend} disabled={isLoading} />
          )}

          {canSend && suggestions.length > 0 && !showWelcomeScreen && (
            <SuggestionChips suggestions={suggestions} onSelect={handleSend} />
          )}

          {(error || mediaUploadError) && (
            <div
              style={{
                padding: '0.625rem 0.875rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: '#f87171',
                fontSize: '0.8125rem',
              }}
            >
              {error || mediaUploadError}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!canSend}
        placeholder={
          !hasImage
            ? 'Describe what you want to create...'
            : 'Describe what you want to do with your photo...'
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
