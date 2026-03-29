/**
 * Full-width chat panel — ChatGPT-inspired dark design.
 * Renders message history, handles auto-scroll, and manages input.
 * State is owned by the parent (ChatPage) and passed in as props.
 */
import { useRef, useEffect, useCallback, useMemo, useState, useLayoutEffect } from 'react';
import type { SogniClient } from '@sogni-ai/sogni-client';
import type { TokenType, Balances } from '@/types/wallet';
import type { UseChatResult } from '@/hooks/useChat';
import type { UIChatMessage } from '@/types/chat';
import type { UploadedFile } from '@/tools/types';
import { QUALITY_PRESETS, type QualityTier } from '@/config/qualityPresets';
import { generateSuggestions, EDIT_INTENT_SUGGESTIONS } from '@/utils/chatSuggestions';
import { FullscreenMediaViewer, type MediaItem } from '@/components/FullscreenMediaViewer';
import { getImage } from '@/utils/galleryDB';
import { useLayout } from '@/layouts/AppLayout';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTypingPlaceholder } from '@/hooks/useTypingPlaceholder';
import { getVariantById } from '@/config/modelVariants';
import { uint8ArrayToDataUrl } from '@/utils/imageProcessing';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SuggestionChips } from './SuggestionChips';
import { FileDropZone } from './FileDropZone';
import { IntentCaptureCard } from './IntentCaptureCard';

/** Number of messages to show per pagination page */
const PAGE_SIZE = 40;

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
  qualityTier: QualityTier;
  onQualityTierChange: (tier: QualityTier) => void;
  safeContentFilter?: boolean;
  onContentFilterChange?: (enabled: boolean) => void;
  onResultsChange?: (urls: string[]) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onUploadClick?: (intent?: 'edit' | 'video' | 'restore') => void;
  uploadIntent?: 'edit' | 'video' | 'restore' | null;
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
  /** Dismiss the media upload error */
  onClearMediaUploadError?: () => void;
  /** Add a media file (audio, video, or extra image) */
  onAddMediaFile?: (file: File) => Promise<void>;
  /** Remove a media file by index */
  onRemoveMediaFile?: (index: number) => void;
  /** Called when a file is dropped onto the chat panel (drag-and-drop) */
  onFileDrop?: (file: File) => void;
  /** Get a blob URL preview for an image at the given index */
  getPreviewUrl?: (index: number) => string | null;
  /** Called when user clicks "Branch in new chat" in media actions menu */
  onBranchChat?: (message: UIChatMessage) => void;
  /** Called when user clicks "Try again" or switches model in media actions menu */
  onRetry?: (message: UIChatMessage, modelKey?: string) => void;
  /** Whether the user has any saved personas (for suggestion chip selection) */
  hasPersonas?: boolean;
  /** Personalized welcome heading (e.g. "Evening, Mark!") */
  welcomeGreeting?: string;
  /** Opens the persona editor to add a new persona */
  onAddPersona?: () => void;
}

/** Minimal dropdown for quality tier selection */
const QualityDropdown: React.FC<{
  qualityTier: QualityTier;
  onQualityTierChange: (tier: QualityTier) => void;
  disabled?: boolean;
}> = ({ qualityTier, onQualityTierChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = QUALITY_PRESETS[qualityTier];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#8e8e8e' }}>
          Default Media Quality: {selected.label}
        </span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" style={{
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
          marginLeft: '1px',
        }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#2a2a2a',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '0.375rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          zIndex: 50,
          overflow: 'hidden',
          minWidth: '120px',
        }}>
          {(['fast', 'hq', 'pro'] as const).map((tier) => {
            const isSelected = qualityTier === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => {
                  onQualityTierChange(tier);
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: isSelected ? 600 : 400,
                  background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  color: isSelected ? '#ececec' : '#8e8e8e',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                {QUALITY_PRESETS[tier].label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
  safeContentFilter,
  onContentFilterChange,
  onResultsChange,
  onLoadingChange,
  onUploadClick: _onUploadClick,
  uploadIntent,
  onTokenSwitch,
  onInsufficientCredits,
  onClearAll,
  onOpenDrawer,
  downloadSlug,
  uploadedFiles,
  isMediaUploading,
  mediaUploadError,
  onClearMediaUploadError,
  onAddMediaFile,
  onRemoveMediaFile,
  onFileDrop,
  getPreviewUrl,
  onBranchChat,
  onRetry,
  hasPersonas,
  welcomeGreeting,
  onAddPersona,
}: ChatPanelProps) {
  const { selectedModelVariant, setSelectedModelVariant, requestDisableContentFilter } = useLayout();
  const isMobile = useMediaQuery('(max-width: 743px)');
  const {
    messages,
    isLoading,
    error,
    allResultUrls,
    analysisSuggestions,
    sendMessage,
    reset,
  } = chat;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevResultCountRef = useRef(0);
  const prevMessageCountRef = useRef(messages.length);
  const isUserNearBottomRef = useRef(true);
  const [fullscreenState, setFullscreenState] = useState<{ items: MediaItem[]; index: number } | null>(null);
  // Track blob URLs created for the fullscreen viewer so we can revoke them on close
  const fullscreenBlobUrlsRef = useRef<string[]>([]);
  // Revoke any outstanding fullscreen blob URLs on unmount
  useEffect(() => {
    return () => {
      fullscreenBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      fullscreenBlobUrlsRef.current = [];
    };
  }, []);

  // Message pagination — show last PAGE_SIZE messages initially, expand on scroll-up
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const hasAudio = !!(uploadedFiles && uploadedFiles.some(f => f.type === 'audio'));

  // Wrap acceptModelSwitch to also update the header model selector
  const handleAcceptModelSwitch = useCallback(() => {
    // Pick the unrestricted variant that matches the current think setting
    const current = getVariantById(selectedModelVariant);
    const targetVariant = current.think ? 'thinking-unrestricted' : 'unrestricted';
    setSelectedModelVariant(targetVariant);
    chat.acceptModelSwitch();
  }, [chat, selectedModelVariant, setSelectedModelVariant]);

  const suggestions = useMemo(
    () => {
      if (isLoading) return [];

      // Upload-intent overrides only apply before any tool has completed.
      // Once a tool runs, defer to generateSuggestions() for tool-contextual chips.
      const hasCompletedTool = messages.some(m => m.role === 'assistant' && m.lastCompletedTool);
      if (!hasCompletedTool) {
        if (uploadIntent === 'restore' && imageData) return [];
        if (uploadIntent === 'edit' && imageData) return EDIT_INTENT_SUGGESTIONS;
        // For video intent, use analysis suggestions directly (skip restoration preset chips)
        if (uploadIntent === 'video' && imageData && analysisSuggestions && analysisSuggestions.length > 0) {
          return analysisSuggestions;
        }
      }

      return generateSuggestions(messages, analysisSuggestions, !!imageData, hasPersonas, hasAudio);
    },
    [messages, isLoading, analysisSuggestions, imageData, uploadIntent, hasPersonas, hasAudio],
  );

  // Smart auto-scroll — only for new messages or active LLM text streaming,
  // NOT for tool progress updates (which would rubber-band when user scrolls up).
  const messageCount = messages.length;
  const hasStreamingMessage = messages.some((m) => m.isStreaming);
  useEffect(() => {
    if (!isUserNearBottomRef.current) return;
    const isNewMessage = messageCount !== prevMessageCountRef.current;
    if (isNewMessage || hasStreamingMessage) {
      prevMessageCountRef.current = messageCount;
      messagesEndRef.current?.scrollIntoView({ behavior: isNewMessage ? 'smooth' : 'instant' });
    }
  }, [messageCount, hasStreamingMessage, suggestions]);

  // ResizeObserver-based auto-scroll — maintain scroll position when content
  // grows (e.g. new messages, images loading). Skipped during tool execution
  // to prevent rubber-banding when the user scrolls up during rendering.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let prevHeight = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const newHeight = container.scrollHeight;
      if (newHeight > prevHeight && isUserNearBottomRef.current && !isLoading) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      prevHeight = newHeight;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isLoading]);

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
      // Only attach image previews to the first user message — once images are
      // visible in the message stream they shouldn't be re-attached on every send.
      const hasImageInMessages = messages.some(
        (m) => m.role === 'user' &&
          ((m.uploadedImageUrls && m.uploadedImageUrls.length > 0) || m.uploadedImageUrl),
      );
      const uploadedImageUrls: string[] = [];
      if (!hasImageInMessages && uploadedFiles) {
        // Use persistent data URLs (not ephemeral blob: URLs) so uploaded
        // image previews survive page refresh and session switching.
        uploadedFiles.forEach((f) => {
          if (f.type === 'image') {
            uploadedImageUrls.push(uint8ArrayToDataUrl(f.data, f.mimeType));
          }
        });
      }
      sendMessage(content, {
        sogniClient,
        imageData,
        width,
        height,
        tokenType,
        balances,
        qualityTier,
        safeContentFilter,
        onContentFilterChange,
        requestDisableContentFilter,
        uploadedFiles,
        onTokenSwitch,
        onInsufficientCredits,
        modelVariantId: selectedModelVariant,
        uploadedImageUrls: uploadedImageUrls.length > 0 ? uploadedImageUrls : undefined,
      });
    },
    [sogniClient, imageData, width, height, tokenType, balances, qualityTier, safeContentFilter, onContentFilterChange, requestDisableContentFilter, uploadedFiles, onTokenSwitch, onInsufficientCredits, sendMessage, selectedModelVariant, messages],
  );

  const handleMediaClick = useCallback(async (message: UIChatMessage, index: number, mediaType: 'image' | 'video' | 'audio') => {
    // Revoke any blob URLs from a previous fullscreen open (prevents leaks on rapid clicks)
    fullscreenBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    fullscreenBlobUrlsRef.current = [];

    const items: MediaItem[] = [];
    const isVideoTool = message.toolProgress && ['animate_photo', 'generate_video', 'sound_to_video', 'video_to_video', 'stitch_video', 'orbit_video'].includes(message.toolProgress.toolName);

    // Resolve a gallery ID to a persistent blob URL, falling back to the original remote URL
    const resolveUrl = async (url: string, galleryId?: string): Promise<string> => {
      if (!galleryId) return url;
      try {
        const img = await getImage(galleryId);
        if (img?.blob) {
          const blobUrl = URL.createObjectURL(img.blob);
          fullscreenBlobUrlsRef.current.push(blobUrl);
          return blobUrl;
        }
      } catch { /* fall back to remote URL */ }
      return url;
    };

    // Build items from finalized results, preferring gallery blob URLs over remote CDN URLs
    if (message.imageResults) {
      const resolved = await Promise.all(
        message.imageResults.map((url, i) => resolveUrl(url, message.galleryImageIds?.[i]))
      );
      items.push(...resolved.map(url => ({ type: 'image' as const, url })));
    }
    if (message.videoResults) {
      const resolved = await Promise.all(
        message.videoResults.map((url, i) => resolveUrl(url, message.galleryVideoIds?.[i]))
      );
      items.push(...resolved.map(url => ({ type: 'video' as const, url, aspectRatio: message.videoAspectRatio })));
    }
    if (message.audioResults) {
      const resolved = await Promise.all(
        message.audioResults.map((url, i) => resolveUrl(url, message.galleryAudioIds?.[i]))
      );
      items.push(...resolved.map(url => ({ type: 'audio' as const, url })));
    }

    // During active generation, completed results live in perJobProgress, not imageResults.
    // Pull them in so clicking a completed progress slot actually opens the viewer.
    // Build in slot order and track which position the clicked slot maps to.
    let progressClickIndex = 0;
    if (items.length === 0 && message.toolProgress?.perJobProgress) {
      const vidAR = message.toolProgress.videoAspectRatio;
      const sortedKeys = Object.keys(message.toolProgress.perJobProgress)
        .map(Number)
        .sort((a, b) => a - b);
      for (const key of sortedKeys) {
        const job = message.toolProgress.perJobProgress[key];
        if (job.resultUrl) {
          if (key === index) progressClickIndex = items.length;
          items.push({
            type: isVideoTool ? 'video' : 'image',
            url: job.resultUrl,
            ...(isVideoTool && vidAR ? { aspectRatio: vidAR } : {}),
          });
        }
      }
    }

    if (items.length === 0) return; // nothing to show

    // Find the correct starting index based on media type and index within that type
    let startIndex = 0;
    if (message.toolProgress?.perJobProgress && !message.imageResults && !message.videoResults && !message.audioResults) {
      // Clicked a progress slot — use the mapped position
      startIndex = progressClickIndex;
    } else if (mediaType === 'video') {
      startIndex = (message.imageResults?.length || 0) + index;
    } else if (mediaType === 'audio') {
      startIndex = (message.imageResults?.length || 0) + (message.videoResults?.length || 0) + index;
    } else {
      startIndex = index;
    }
    // Clamp to valid range
    startIndex = Math.min(startIndex, items.length - 1);
    setFullscreenState({ items, index: startIndex });
  }, []);

  const processedMessages = useMemo(() => {
    let msgs = messages;

    // Build fresh blob URLs for the synthetic user-upload message (efficient for live display).
    const freshBlobUrls: string[] = [];
    if (uploadedFiles && getPreviewUrl) {
      uploadedFiles.forEach((f, i) => {
        if (f.type === 'image') {
          const url = getPreviewUrl(i);
          if (url) freshBlobUrls.push(url);
        }
      });
    }

    // Check whether any real message already displays the uploaded images
    // (either the legacy 'user-upload' from analyzeImage, or a sent message
    // that included uploadedImageUrls).
    const hasUploadEntry = msgs.some(
      (m) => m.id === 'user-upload' || (m.uploadedImageUrls && m.uploadedImageUrls.length > 0),
    );

    if (!hasUploadEntry && freshBlobUrls.length > 0) {
      // Synthesize a presentational upload entry at the start of the conversation
      // so the uploaded images appear at the top of the chat stream.
      const uploadMsg: UIChatMessage = {
        id: 'user-upload',
        role: 'user',
        content: '',
        timestamp: 0,
        uploadedImageUrls: freshBlobUrls,
      };
      msgs = [uploadMsg, ...msgs];
    }

    // Refresh the synthetic user-upload blob URLs (they're always regenerated
    // from uploadedFiles so they stay valid for the current page session).
    if (freshBlobUrls.length > 0) {
      msgs = msgs.map((msg) =>
        msg.id === 'user-upload' && msg.uploadedImageUrls
          ? { ...msg, uploadedImageUrls: freshBlobUrls }
          : msg,
      );
    }

    // Backward compat: replace stale blob: URLs in persisted messages with
    // persistent data URLs generated from the restored uploadedFiles data.
    // New messages already store data URLs (see handleSend), but sessions
    // saved before this fix still have ephemeral blob: URLs that break on
    // page refresh.
    if (uploadedFiles?.length) {
      const hasStaleBlobs = msgs.some(
        (m) => m.id !== 'user-upload' && m.uploadedImageUrls?.some(u => u.startsWith('blob:')),
      );
      if (hasStaleBlobs) {
        const freshDataUrls: string[] = [];
        uploadedFiles.forEach(f => {
          if (f.type === 'image') {
            freshDataUrls.push(uint8ArrayToDataUrl(f.data, f.mimeType));
          }
        });
        if (freshDataUrls.length > 0) {
          msgs = msgs.map((msg) => {
            if (msg.id === 'user-upload' || !msg.uploadedImageUrls?.length) return msg;
            const needsRefresh = msg.uploadedImageUrls.some(u => u.startsWith('blob:'));
            if (!needsRefresh) return msg;
            // Replace stale blob URLs positionally from available data URLs
            const refreshed = msg.uploadedImageUrls.map((url, i) =>
              url.startsWith('blob:') && i < freshDataUrls.length ? freshDataUrls[i] : url,
            );
            return { ...msg, uploadedImageUrls: refreshed };
          });
        }
      }
    }

    // Legacy: inject single imageUrl for old-style user-upload messages
    if (imageUrl) {
      msgs = msgs.map((msg) =>
        msg.id === 'user-upload' && !msg.uploadedImageUrls
          ? { ...msg, uploadedImageUrl: imageUrl }
          : msg,
      );
    }

    return msgs;
  }, [messages, uploadedFiles, getPreviewUrl, imageUrl]);

  // Paginated messages — show the most recent `visibleCount` messages,
  // but always pin the upload entry so the original photo stays at the top.
  const paginatedMessages = useMemo(() => {
    if (processedMessages.length <= visibleCount) return processedMessages;
    const sliced = processedMessages.slice(-visibleCount);
    // Find the upload entry near the start of the conversation
    const uploadEntry = processedMessages.find(
      (m) => m.id === 'user-upload' || m.uploadedImageUrl || (m.uploadedImageUrls && m.uploadedImageUrls.length > 0),
    );
    if (uploadEntry && !sliced.includes(uploadEntry)) {
      return [uploadEntry, ...sliced];
    }
    return sliced;
  }, [processedMessages, visibleCount]);

  const hasMoreMessages = processedMessages.length > visibleCount;

  // Reset pagination when the session changes (detected by first message ID changing)
  const prevFirstMsgIdRef = useRef(processedMessages[0]?.id);
  useEffect(() => {
    const firstId = processedMessages[0]?.id;
    if (firstId !== prevFirstMsgIdRef.current) {
      prevFirstMsgIdRef.current = firstId;
      setVisibleCount(PAGE_SIZE);
    }
  }, [processedMessages]);

  // Load more messages when scrolling near the top
  const isLoadingMoreRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  useEffect(() => {
    if (!hasMoreMessages) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingMoreRef.current) {
          isLoadingMoreRef.current = true;
          // Capture scroll height synchronously before the state update triggers re-render
          const container = scrollContainerRef.current;
          if (container) {
            prevScrollHeightRef.current = container.scrollHeight;
          }
          setVisibleCount((prev) => prev + PAGE_SIZE);
        }
      },
      { root: scrollContainerRef.current, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreMessages]);

  // Maintain scroll position when loading older messages (prevents jumping to top)
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !prevScrollHeightRef.current || !isLoadingMoreRef.current) return;
    const heightDiff = container.scrollHeight - prevScrollHeightRef.current;
    if (heightDiff > 0) {
      container.scrollTop += heightDiff;
    }
    prevScrollHeightRef.current = 0;
    isLoadingMoreRef.current = false;
  }, [paginatedMessages]);


  const hasImage = !!(uploadedFiles && uploadedFiles.some(f => f.type === 'image'));
  const canSend = isAuthenticated && !!sogniClient;

  // Hide file previews in ChatInput once images have been embedded in a sent message
  // (the images are visible in the message stream, showing them in the input is redundant).
  // Data stays in uploadedFiles for subsequent tool calls — only the preview is suppressed.
  const chatInputFiles = useMemo(() => {
    if (!uploadedFiles?.length) return undefined;
    const hasImageInMessages = messages.some(
      (m) => m.role === 'user' &&
        ((m.uploadedImageUrls && m.uploadedImageUrls.length > 0) || m.uploadedImageUrl),
    );
    return hasImageInMessages ? undefined : uploadedFiles;
  }, [uploadedFiles, messages]);

  // True when the welcome empty state UI is showing (has its own category chips)
  const showWelcomeScreen = !hasImage && messages.length <= 1 && messages[0]?.id === 'welcome' && !isLoading;

  // Rotating typewriter placeholder for the empty state
  const typingPlaceholder = useTypingPlaceholder({ enabled: showWelcomeScreen });

  const showIntentCapture = useMemo(() => {
    if (!hasImage || isLoading) return false;
    if (uploadIntent !== 'restore') return false;
    const hasUserTextMessage = messages.some(
      (m) => m.role === 'user' && m.id !== 'user-upload' && m.content?.trim(),
    );
    return !hasUserTextMessage;
  }, [hasImage, isLoading, messages, uploadIntent]);

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
          <QualityDropdown
            qualityTier={qualityTier}
            onQualityTierChange={onQualityTierChange}
            disabled={isLoading}
          />

          {messages.length > 1 && (
            <button
              onClick={onClearAll || (() => reset())}
              title={isMobile ? 'Start a new conversation' : 'Clear conversation and start fresh'}
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
              {isMobile ? 'New' : 'Clear'}
            </button>
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
                {welcomeGreeting || 'What would you like to create?'}
              </h1>

              {/* What can I do? chip */}
              <button
                onClick={() => handleSend('What can I do? Give me a comprehensive overview of all your creative capabilities with concrete examples for each.')}
                disabled={!canSend}
                className="radiant-orb-hover"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.375rem 0.875rem',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.10)',
                  borderRadius: 'var(--radius-pill)',
                  cursor: canSend ? 'pointer' : 'default',
                  color: '#8e8e8e',
                  fontSize: '0.8125rem',
                  fontWeight: 400,
                  transition: 'all 0.2s',
                  opacity: canSend ? 1 : 0.5,
                }}
                onMouseEnter={(e) => {
                  if (!canSend) return;
                  e.currentTarget.style.color = '#ececec';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8e8e8e';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.10)';
                }}
              >
                What can you help me create?
              </button>

              {/* Add Persona CTA — only for logged-in users without personas */}
              {isAuthenticated && !hasPersonas && onAddPersona && (
                <button
                  onClick={onAddPersona}
                  className="radiant-orb-hover"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.375rem 0.875rem',
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.10)',
                    borderRadius: 'var(--radius-pill)',
                    cursor: 'pointer',
                    color: '#8e8e8e',
                    fontSize: '0.8125rem',
                    fontWeight: 400,
                    transition: 'all 0.2s',
                    marginTop: '0.5rem',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ececec';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#8e8e8e';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.10)';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Add your Persona
                </button>
              )}

            </div>
          )}

          {/* Load-more sentinel — triggers pagination when scrolled near top */}
          {hasMoreMessages && (
            <div ref={loadMoreSentinelRef} style={{ height: 1, flexShrink: 0 }} />
          )}

          {/* Chat messages — skip welcome message when in no-image empty state */}
          {paginatedMessages.map((msg) => {
            // Hide the welcome sentinel message when the empty state UI is showing
            // Always hide the welcome sentinel — it's only used to detect the empty state,
            // never displayed as an actual chat bubble.
            if (msg.id === 'welcome') return null;
            return (
              <ChatMessage
                key={msg.id}
                message={msg}
                imageUrl={imageUrl}
                onImageClick={(_url, index) => handleMediaClick(msg, index, 'image')}
                onVideoClick={(_url, index) => handleMediaClick(msg, index, 'video')}
                onAudioClick={(_url, index) => handleMediaClick(msg, index, 'audio')}
                onProgressMediaClick={(index, mediaType) => handleMediaClick(msg, index, mediaType)}
                onCancelTool={msg.toolProgress ? chat.cancelToolExecution : undefined}
                onAcceptModelSwitch={msg.modelRefusal ? handleAcceptModelSwitch : undefined}
                onDeclineModelSwitch={msg.modelRefusal ? chat.declineModelSwitch : undefined}
                downloadSlug={downloadSlug}
                onBranchChat={onBranchChat}
                onRetry={onRetry}
              />
            );
          })}

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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
              }}
            >
              <span>{error || mediaUploadError}</span>
              <button
                onClick={() => { chat.clearError(); onClearMediaUploadError?.(); }}
                aria-label="Dismiss error"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#f87171',
                  cursor: 'pointer',
                  padding: '0.125rem',
                  lineHeight: 1,
                  fontSize: '1rem',
                  flexShrink: 0,
                  opacity: 0.7,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
              >
                ✕
              </button>
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
          typingPlaceholder ||
          (isMobile
            ? (hasImage ? 'What should I do with your photo?' : 'What do you want to create?')
            : (hasImage ? 'Describe what you want to do with your photo...' : 'Describe what you want to create...'))
        }
        uploadedFiles={chatInputFiles}
        isMediaUploading={isMediaUploading}
        onAddMediaFile={onAddMediaFile}
        onRemoveMediaFile={onRemoveMediaFile}
        getPreviewUrl={getPreviewUrl}
        isLoading={isLoading}
        onCancel={chat.cancelToolExecution}
        isMobile={isMobile}
      />

      {/* Fullscreen media viewer */}
      {fullscreenState && (
        <FullscreenMediaViewer
          items={fullscreenState.items}
          currentIndex={fullscreenState.index}
          onClose={() => {
            setFullscreenState(null);
            // Revoke blob URLs created for the fullscreen viewer to free memory
            fullscreenBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
            fullscreenBlobUrlsRef.current = [];
          }}
          onNavigate={(index) => setFullscreenState(prev => prev ? { ...prev, index } : null)}
        />
      )}
    </div>
    </FileDropZone>
  );
}
