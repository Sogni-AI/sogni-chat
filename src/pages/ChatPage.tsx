/**
 * Chat page — primary interface for Sogni Chat.
 * Full-width conversational interface for AI-assisted photo operations.
 * Owns useChat state and passes it down to ChatPanel.
 * Integrates chat history sidebar on desktop (>=900px).
 */
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useSogniAuth } from '@/services/sogniAuth';
import { useWallet } from '@/hooks/useWallet';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useMediaUpload } from '@/hooks/useMediaUpload';
import { useChat } from '@/hooks/useChat';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useLayout } from '@/layouts/AppLayout';
import { useToastContext } from '@/context/ToastContext';
import { SEOHead } from '@/components/seo/SEOHead';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { Footer } from '@/components/layout/Footer';
import { saveRestorationToGallery } from '@/services/galleryService';
import { generateSessionTitle } from '@/services/chatService';
import { slugify } from '@/utils/downloadFilename';
import type { ChatSession } from '@/types/chat';
import type { QualityTier } from '@/config/qualityPresets';
import { QUALITY_PRESETS, getSavedQualityTier, saveQualityTier } from '@/config/qualityPresets';
import { useRestorationCostEstimation } from '@/hooks/useRestorationCostEstimation';
import type { TokenType } from '@/types/wallet';
import { warmUpAudio } from '@/utils/sonicLogos';
import '@/components/chat/chat.css';

/** Returns true if a title is predominantly numeric or a known placeholder — not human-readable */
function isGenericTitle(title: string): boolean {
  if (!title) return true;
  if (title === 'New Photo' || title.startsWith('Photo Restore') || title.startsWith('New Session')) return true;
  // All numbers/separators (e.g. "646376662 10226279100")
  if (/^\d[\d\s_-]*$/.test(title.trim())) return true;
  // Browser-generated filenames: "images (3)", "photo-2", "image_3", "download", "Untitled", etc.
  if (/^(images?|photos?|downloads?|pictures?|files?|untitled|screenshot)([\s_-]*\(?\d+\)?)?$/i.test(title.trim())) return true;
  // Predominantly digits: if >60% of alphanumeric chars are digits, it's likely a camera/social filename
  const alphanumeric = title.replace(/[^a-zA-Z0-9]/g, '');
  if (alphanumeric.length > 0) {
    const digitCount = (title.match(/\d/g) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return true;
  }
  return false;
}

/** Generate a clean session title, preferring analysis text over raw filenames */
function deriveSessionTitle(filename?: string, sessionNumber?: number): string {
  const placeholder = sessionNumber ? `New Session #${sessionNumber}` : 'New Session';
  if (!filename) return placeholder;
  const base = filename.replace(/\.[^.]+$/, '');
  // Camera/social media patterns: IMG_1234, DSC-5678, 646376662_10226279100_n, etc.
  if (/^[A-Z]{0,4}[-_\s]?\d{3,}[-_\s\d]*$/i.test(base)) return placeholder;
  // Browser-generated filenames: "images (3)", "photo-2", "image_3", "download", "Untitled", etc.
  if (/^(images?|photos?|downloads?|pictures?|files?|untitled|screenshot)([\s_-]*\(?\d+\)?)?$/i.test(base.trim())) return placeholder;
  // Clean up underscores/dashes to spaces, collapse whitespace
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  // Predominantly digits (>60%): social media filenames like "646376662_10226279100_n"
  const alphanumeric = cleaned.replace(/[^a-zA-Z0-9]/g, '');
  if (alphanumeric.length > 0) {
    const digitCount = (cleaned.match(/\d/g) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return placeholder;
  }
  return cleaned || placeholder;
}


export default function ChatPage() {
  const { isAuthenticated, getSogniClient } = useSogniAuth();
  const { tokenType, balances, switchPaymentMethod } = useWallet();
  const {
    imageUrl,
    imageData,
    width,
    height,
    error: uploadError,
    upload,
    clear: clearUpload,
    loadFromData,
  } = useImageUpload({ persist: true });
  const {
    uploadedFiles,
    isUploading: isMediaUploading,
    error: mediaUploadError,
    addFile: addMediaFile,
    removeFile: removeMediaFile,
    clearFiles: clearMediaFiles,
  } = useMediaUpload();
  const chat = useChat();
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    switchSession,
    deleteSessionById,
    saveCurrentSession,
    getThumbnailUrl,
    updateThumbnail,
    initialized: sessionsInitialized,
    pendingRestore,
    clearPendingRestore,
  } = useChatSessions();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const { showOutOfCreditsPopup, showSignupModal } = useLayout();
  const { showToast } = useToastContext();

  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Background job tracking: which sessions have running jobs, which have unread results
  const [activeJobSessionIds, setActiveJobSessionIds] = useState<Set<string>>(new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(new Set());
  const [qualityTier, setQualityTierState] = useState<QualityTier>(getSavedQualityTier);
  const setQualityTier = useCallback((tier: QualityTier) => {
    setQualityTierState(tier);
    saveQualityTier(tier);
  }, []);
  const { cost: estimatedCost, loading: costLoading } = useRestorationCostEstimation({
    qualityTier,
    imageCount: 1,
    tokenType,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gallerySavedRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTitleRef = useRef<string>('New Session');
  const sessionCreatedAtRef = useRef<number>(Date.now());
  const sessionUpdatedAtRef = useRef<number>(Date.now());
  const sessionDirtyRef = useRef(false);
  const isRestoringRef = useRef(false);
  const generatingTitleRef = useRef(false);

  // Keep refs for save function dependencies so effects don't re-run on every render
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const imageDataRef = useRef(imageData);
  imageDataRef.current = imageData;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;

  // Track counts for immediate save when new content is generated
  const prevResultCountRef = useRef(0);
  const prevVideoCountRef = useRef(0);
  const prevMsgCountRef = useRef(0);
  const prevGalleryIdCountRef = useRef(0);

  // (Auth check moved to early return below — no redirect needed since ChatPage IS "/")

  // Keep useChat's sessionIdRef in sync with the active session
  const { loadFromSession, setSessionId, setOnBackgroundComplete, setOnBackgroundGallerySaved } = chat;
  useEffect(() => {
    setSessionId(activeSessionId);
  }, [activeSessionId, setSessionId]);
  useEffect(() => {
    if (!pendingRestore) return;
    isRestoringRef.current = true;
    const videoMsgCount = pendingRestore.uiMessages.filter(m => m.videoResults?.length).length;
    const videoUrlCount = pendingRestore.uiMessages.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const galleryVideoIdCount = pendingRestore.uiMessages.filter(m => m.galleryVideoIds?.length).length;
    console.log(`[CHAT PAGE] Restoring session: ${pendingRestore.uiMessages.length} msgs, ${videoMsgCount} with videos (${videoUrlCount} urls), ${galleryVideoIdCount} with gallery video IDs, hasImageData=${!!pendingRestore.imageData}`);
    loadFromSession(pendingRestore);
    setSessionId(pendingRestore.id);
    sessionTitleRef.current = pendingRestore.title;
    sessionCreatedAtRef.current = pendingRestore.createdAt;
    sessionUpdatedAtRef.current = pendingRestore.updatedAt;
    sessionDirtyRef.current = false;
    gallerySavedRef.current = pendingRestore.allResultUrls.length > 0;
    setResultUrls(pendingRestore.allResultUrls);
    // Restore image data from session
    if (pendingRestore.imageData && pendingRestore.width && pendingRestore.height) {
      loadFromData(pendingRestore.imageData, pendingRestore.width, pendingRestore.height);
    }
    clearPendingRestore();
    // Allow saves again after state settles (must exceed 1500ms debounce)
    const timer = setTimeout(() => { isRestoringRef.current = false; }, 2000);
    return () => clearTimeout(timer);
  }, [pendingRestore, loadFromSession, setSessionId, loadFromData, clearPendingRestore]);

  // ── Stable save function — reads from refs so it never triggers re-renders ──
  const saveActiveSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id || isRestoringRef.current) {
      console.log(`[CHAT PAGE] saveActiveSession skipped: id=${id}, isRestoring=${isRestoringRef.current}`);
      return;
    }
    const state = chatRef.current.getSessionState();
    // Don't save if only welcome message
    if (state.uiMessages.length <= 1 && state.uiMessages[0]?.id === 'welcome') return;

    // Only bump updatedAt when content actually changed (dirty flag)
    const updatedAt = sessionDirtyRef.current ? Date.now() : sessionUpdatedAtRef.current;

    const session: ChatSession = {
      id,
      title: sessionTitleRef.current,
      createdAt: sessionCreatedAtRef.current,
      updatedAt,
      uiMessages: state.uiMessages,
      conversation: state.conversation,
      allResultUrls: state.allResultUrls,
      analysisSuggestions: state.analysisSuggestions,
      imageData: imageDataRef.current ?? undefined,
      width: widthRef.current,
      height: heightRef.current,
    };

    const msgsWithVideos = state.uiMessages.filter(m => m.videoResults?.length);
    const totalVideoUrls = state.uiMessages.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const msgsWithGalleryVideoIds = state.uiMessages.filter(m => m.galleryVideoIds?.length);
    console.log(`[CHAT PAGE] saveActiveSession: id=${id}, dirty=${sessionDirtyRef.current}, ${state.uiMessages.length} msgs, ${state.allResultUrls.length} allResultUrls, ${state.uiMessages.filter(m => m.imageResults?.length).length} msgs with images, ${msgsWithVideos.length} msgs with videos (${totalVideoUrls} urls), ${msgsWithGalleryVideoIds.length} msgs with gallery video IDs, hasImageData=${!!imageDataRef.current}`);
    await saveCurrentSession(id, session);
    sessionUpdatedAtRef.current = updatedAt;
    sessionDirtyRef.current = false;
    console.log(`[CHAT PAGE] saveActiveSession: IndexedDB write completed for ${id}`);
  }, [saveCurrentSession]); // saveCurrentSession is stable (useCallback in useChatSessions)

  // Primitive deps for auto-save (avoids firing on every render)
  const msgCount = chat.messages.length;
  const resultCount = chat.allResultUrls.length;
  const chatIsLoading = chat.isLoading;
  const chatIsSending = chat.isSending;

  // Count video results across all messages (videos aren't tracked in allResultUrls)
  const videoResultCount = useMemo(() =>
    chat.messages.reduce((count, msg) => count + (msg.videoResults?.length || 0), 0),
    [chat.messages],
  );

  // Count gallery IDs so saves trigger when video gallery IDs arrive via onGallerySaved
  const galleryIdCount = useMemo(() =>
    chat.messages.reduce((count, msg) =>
      count + (msg.galleryImageIds?.length || 0) + (msg.galleryVideoIds?.length || 0), 0),
    [chat.messages],
  );

  // ── Immediate save when new images, videos, or gallery IDs are generated ──
  // Fires even while chatIsLoading=true (mid-tool-calling-loop),
  // ensuring generated content is persisted before the user can refresh.
  // Gallery IDs are included because they're the ONLY way to render videos
  // after remote URLs expire — without them, refreshed sessions lose videos.
  useEffect(() => {
    const newImages = resultCount > prevResultCountRef.current;
    const newVideos = videoResultCount > prevVideoCountRef.current;
    const newGalleryIds = galleryIdCount > prevGalleryIdCountRef.current;
    // Always update refs to track current counts
    prevResultCountRef.current = resultCount;
    prevVideoCountRef.current = videoResultCount;
    prevGalleryIdCountRef.current = galleryIdCount;
    // Only save if session is active and not restoring
    if (!activeSessionId || isRestoringRef.current) return;
    if (newImages || newVideos || newGalleryIds) {
      sessionDirtyRef.current = true;
      console.log(`[CHAT PAGE] Immediate save triggered: resultCount=${resultCount}, videoResultCount=${videoResultCount}, galleryIdCount=${galleryIdCount}, newImages=${newImages}, newVideos=${newVideos}, newGalleryIds=${newGalleryIds}`);
      saveActiveSession();
    }
  }, [resultCount, videoResultCount, galleryIdCount, activeSessionId, saveActiveSession]);

  // ── Debounced save for text/message changes when chat is idle ──
  // NOTE: No cleanup returned — pending saves must NOT be cancelled when
  // loading starts, otherwise content generated between operations is lost.
  // Gallery ID changes are handled by the immediate save above — this effect
  // only needs to handle message count and result count changes.
  useEffect(() => {
    // Detect actual content changes (not just re-renders from session switching)
    if (msgCount !== prevMsgCountRef.current) {
      // Only mark dirty if not restoring (restoring loads existing content, not new content)
      if (!isRestoringRef.current) {
        sessionDirtyRef.current = true;
      }
      prevMsgCountRef.current = msgCount;
    }

    if (!chatIsLoading && !chatIsSending && activeSessionId && !isRestoringRef.current) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveActiveSession();
        saveTimeoutRef.current = null;
      }, 1500);
    }
  }, [msgCount, resultCount, chatIsLoading, chatIsSending, activeSessionId, saveActiveSession]);

  // Save when tab becomes hidden (more reliable than beforeunload for async ops),
  // plus beforeunload as fallback, plus unmount cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) saveActiveSession();
    };
    const handleBeforeUnload = () => { saveActiveSession(); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Clear any pending debounced save timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      saveActiveSession();
    };
  }, [saveActiveSession]);

  // Auto-save to gallery when results arrive and chat is no longer loading
  useEffect(() => {
    if (
      resultUrls.length > 0 &&
      !chatLoading &&
      imageData &&
      width &&
      height &&
      !gallerySavedRef.current
    ) {
      gallerySavedRef.current = true;
      saveRestorationToGallery({
        sourceImageBlob: new Blob([imageData as BlobPart], { type: 'image/jpeg' }),
        sourceFilename: `source-${Date.now()}.jpg`,
        sourceWidth: width,
        sourceHeight: height,
        sourceMimeType: 'image/jpeg',
        resultUrls,
        model: QUALITY_PRESETS[qualityTier].model,
        prompt: 'Chat restoration',
        sdkJobIds: [],
      }).then(({ galleryImageIds }) => {
        // Store gallery IDs on chat messages for persistent blob-based rendering
        if (galleryImageIds.length > 0) {
          chatRef.current.setGalleryIds(galleryImageIds);
          // Trigger a save so gallery IDs are persisted in the session
          sessionDirtyRef.current = true;
          saveActiveSession();
        }
      }).catch((err) => {
        console.error('[CHAT PAGE] Failed to save to gallery:', err);
      });
    }
  }, [resultUrls, chatLoading, imageData, width, height]);

  // Update thumbnail when image is available for the active session
  useEffect(() => {
    if (activeSessionId && imageData) {
      const blob = new Blob([imageData as BlobPart], { type: 'image/jpeg' });
      updateThumbnail(activeSessionId, blob);
    }
  }, [activeSessionId, imageData, updateThumbnail]);

  // Register background job completion handlers
  useEffect(() => {
    setOnBackgroundComplete(async (sessionId, result) => {
      console.log(`[CHAT PAGE] Background job completed for session ${sessionId}:`, result.toolName);

      // Persist results to IndexedDB for the background session
      const { updateSessionMessages } = await import('@/utils/chatHistoryDB');
      await updateSessionMessages(sessionId, (messages) => {
        return messages.map((msg) => {
          if (msg.id !== result.streamingMsgId) return msg;
          const srcUrl = msg.toolProgress?.sourceImageUrl;
          const vidAR = msg.toolProgress?.videoAspectRatio;
          return {
            ...msg,
            imageResults: result.resultUrls.length > 0 ? result.resultUrls : msg.imageResults,
            videoResults: result.videoResultUrls && result.videoResultUrls.length > 0
              ? result.videoResultUrls
              : msg.videoResults,
            toolProgress: null,
            isStreaming: false,
            sourceImageUrl: srcUrl || msg.sourceImageUrl,
            videoAspectRatio: vidAR || msg.videoAspectRatio,
            content: result.assistantContent || msg.content,
          };
        });
      });

      // Remove from active jobs
      setActiveJobSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });

      // Mark as unread
      setUnreadSessionIds((prev) => new Set(prev).add(sessionId));

      // Play completion sound
      const { playVideoComplete } = await import('@/utils/sonicLogos');
      playVideoComplete();

      // Show toast
      showToast({
        message: result.toolName === 'animate_photo'
          ? 'Video ready in another session!'
          : 'Results ready in another session!',
        type: 'success',
        timeout: 6000,
      });
    });

    setOnBackgroundGallerySaved(async (sessionId, galleryImageIds, galleryVideoIds) => {
      console.log(`[CHAT PAGE] Background gallery saved for session ${sessionId}: ${galleryImageIds.length} images, ${galleryVideoIds.length} videos`);

      const { updateSessionMessages } = await import('@/utils/chatHistoryDB');
      const { applyGalleryIdsToMessages } = await import('@/hooks/useChat');
      await updateSessionMessages(sessionId, (messages) =>
        applyGalleryIdsToMessages(messages, galleryImageIds, galleryVideoIds),
      );
    });
  }, [setOnBackgroundComplete, setOnBackgroundGallerySaved, showToast]);

  // Auto-name session from analysis text via LLM, or first user text message.
  // Wait until the message is fully streamed before generating a title.
  useEffect(() => {
    if (!isGenericTitle(sessionTitleRef.current)) return;
    if (generatingTitleRef.current) return;

    // Prefer analysis text (first non-empty, fully-streamed assistant message)
    const analysisMsg = chat.messages.find(
      (m) => m.role === 'assistant' && m.id !== 'welcome' && !m.isStreaming && m.content?.trim(),
    );
    if (analysisMsg?.content && analysisMsg.content.length >= 10) {
      const sogniClient = getSogniClient();
      if (!sogniClient) return;

      generatingTitleRef.current = true;
      generateSessionTitle(sogniClient, analysisMsg.content, tokenType)
        .then((title) => {
          if (title) {
            sessionTitleRef.current = title;
            sessionDirtyRef.current = true;
            if (activeSessionIdRef.current && !isRestoringRef.current) {
              saveActiveSession();
            }
          }
        })
        .finally(() => {
          generatingTitleRef.current = false;
        });
    } else {
      // Don't fall back to user text if analysis is still streaming
      const stillStreaming = chat.messages.some(
        (m) => m.role === 'assistant' && m.id !== 'welcome' && m.isStreaming,
      );
      if (!stillStreaming) {
        // Fallback: first user text message
        const firstUserMsg = chat.messages.find(
          (m) => m.role === 'user' && m.content?.trim(),
        );
        if (firstUserMsg?.content) {
          sessionTitleRef.current = firstUserMsg.content.slice(0, 60);
          sessionDirtyRef.current = true;
          if (activeSessionIdRef.current && !isRestoringRef.current) {
            saveActiveSession();
          }
        }
      }
    }
  }, [chat.messages, saveActiveSession, getSogniClient, tokenType]);

  // Assign a session ID on first meaningful interaction (only after init completes)
  useEffect(() => {
    if (!sessionsInitialized || pendingRestore) return;
    if (activeSessionId) return;
    // Wait until there's something worth saving (more than welcome msg)
    if (chat.messages.length > 1 || (imageData && chat.messages[0]?.id !== 'welcome')) {
      const newId = createNewSession();
      sessionCreatedAtRef.current = Date.now();
      setActiveSessionId(newId);
    }
  }, [sessionsInitialized, pendingRestore, activeSessionId, chat.messages, imageData, createNewSession, setActiveSessionId]);

  const handleResultsChange = useCallback((urls: string[]) => {
    setResultUrls(urls);
  }, []);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setChatLoading(loading);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Save current session before starting fresh with the new image
      if (activeSessionIdRef.current) await saveActiveSession();

      // Track background jobs before resetting
      if (chatRef.current.isLoading || chatRef.current.isSending) {
        const currentId = activeSessionIdRef.current;
        if (currentId) setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
      }

      isRestoringRef.current = true;
      clearUpload();
      setResultUrls([]);
      gallerySavedRef.current = false;
      chat.reset({ keepBackground: true });
      sessionTitleRef.current = deriveSessionTitle(file.name, sessions.length + 1);
      sessionCreatedAtRef.current = Date.now();
      setActiveSessionId(null);
      setTimeout(() => { isRestoringRef.current = false; }, 2000);

      await upload(file);
    },
    [upload, saveActiveSession, clearUpload, chat, setActiveSessionId, sessions.length],
  );

  const handleUploadClick = useCallback(() => {
    warmUpAudio(); // Pre-warm audio context for iOS
    // Reset value so re-selecting the same file still triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }, []);

  const handleFileDrop = useCallback(
    async (file: File) => {
      // Same flow as handleFileSelect but accepts a File directly (for drag-and-drop)
      if (activeSessionIdRef.current) await saveActiveSession();

      // Track background jobs before resetting
      if (chatRef.current.isLoading || chatRef.current.isSending) {
        const currentId = activeSessionIdRef.current;
        if (currentId) setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
      }

      isRestoringRef.current = true;
      clearUpload();
      setResultUrls([]);
      gallerySavedRef.current = false;
      chat.reset({ keepBackground: true });
      sessionTitleRef.current = deriveSessionTitle(file.name, sessions.length + 1);
      sessionCreatedAtRef.current = Date.now();
      setActiveSessionId(null);
      setTimeout(() => { isRestoringRef.current = false; }, 2000);

      await upload(file);
    },
    [upload, saveActiveSession, clearUpload, chat, setActiveSessionId, sessions.length],
  );

  const handleNewPhoto = useCallback(async () => {
    // Save current session before starting fresh
    if (activeSessionIdRef.current) await saveActiveSession();

    // Track background jobs before resetting
    if (chatRef.current.isLoading || chatRef.current.isSending) {
      const currentId = activeSessionIdRef.current;
      if (currentId) setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
    }

    isRestoringRef.current = true;
    clearUpload();
    setResultUrls([]);
    gallerySavedRef.current = false;
    chat.reset({ keepBackground: true });
    sessionTitleRef.current = `New Session #${sessions.length + 1}`;
    sessionCreatedAtRef.current = Date.now();
    sessionUpdatedAtRef.current = Date.now();
    sessionDirtyRef.current = false;
    setActiveSessionId(null);
    setTimeout(() => { isRestoringRef.current = false; }, 2000);
  }, [clearUpload, chat, saveActiveSession, setActiveSessionId, sessions.length]);

  const handleSelectSession = useCallback(async (id: string) => {
    if (id === activeSessionIdRef.current) return;

    // If current session has running jobs, track it as a background job session
    if (chatRef.current.isLoading || chatRef.current.isSending) {
      const currentId = activeSessionIdRef.current;
      if (currentId) {
        setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
      }
    }

    // Save current session first
    if (activeSessionIdRef.current) await saveActiveSession();

    isRestoringRef.current = true;

    const session = await switchSession(id);
    if (!session) {
      isRestoringRef.current = false;
      return;
    }

    // Restore chat state
    chat.loadFromSession(session);
    sessionTitleRef.current = session.title;
    sessionCreatedAtRef.current = session.createdAt;
    sessionUpdatedAtRef.current = session.updatedAt;
    sessionDirtyRef.current = false;
    // Mark gallery as already saved for restored sessions to prevent duplicate saves
    gallerySavedRef.current = session.allResultUrls.length > 0;
    setResultUrls(session.allResultUrls);

    // Restore image
    if (session.imageData && session.width && session.height) {
      loadFromData(session.imageData, session.width, session.height);
    } else {
      clearUpload();
    }

    // Clear indicators for the newly selected session
    setUnreadSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setActiveJobSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    setTimeout(() => { isRestoringRef.current = false; }, 2000);
  }, [saveActiveSession, switchSession, chat, loadFromData, clearUpload]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const isActive = id === activeSessionIdRef.current;

    // Suppress saves during delete to prevent phantom session creation
    isRestoringRef.current = true;

    if (isActive) {
      // Clear active session BEFORE deleting to prevent saves of stale state
      setActiveSessionId(null);
      clearUpload();
      setResultUrls([]);
      gallerySavedRef.current = false;
      chat.reset();
      sessionTitleRef.current = `New Session #${sessions.length + 1}`;
      sessionCreatedAtRef.current = Date.now();
    }

    await deleteSessionById(id);

    // Clean up background indicators for deleted session
    setActiveJobSessionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setUnreadSessionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });

    setTimeout(() => { isRestoringRef.current = false; }, 2000);
  }, [deleteSessionById, clearUpload, chat, setActiveSessionId, sessions.length]);

  const handleTokenSwitch = useCallback((newType: TokenType) => {
    switchPaymentMethod(newType);
    showToast({
      message: `Switched to ${newType === 'spark' ? 'Spark' : 'SOGNI'} tokens`,
      type: 'info',
      timeout: 4000,
    });
  }, [switchPaymentMethod, showToast]);

  const handleInsufficientCredits = useCallback(() => {
    showOutOfCreditsPopup();
  }, [showOutOfCreditsPopup]);

  const sogniClient = getSogniClient();

  if (!isAuthenticated) {
    return (
      <>
        <SEOHead
          title="AI Creative Studio | Sogni Chat"
          description="Chat with AI to generate images, create videos, compose music, restore photos, and more."
          path="/"
        />
        <main className="flex-1 flex items-center justify-center page-enter">
          <div className="text-center px-6" style={{ maxWidth: '28rem' }}>
            <h1
              className="font-display text-3xl font-bold mb-3"
              style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}
            >
              Welcome to Sogni Chat
            </h1>
            <p className="mb-6" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Generate images, create videos, compose music, restore photos, and more — all powered by AI. Sign in to get started.
            </p>
            <button
              onClick={() => showSignupModal()}
              className="btn-primary px-6 py-3 rounded-xl font-semibold text-base"
              style={{
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign In to Get Started
            </button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SEOHead
        title="AI Creative Studio | Sogni Chat"
        description="Chat with AI to generate images, create videos, compose music, restore photos, and more."
        path="/"
      />
      <main className="flex-1 flex flex-col min-h-0 page-enter">
        <div className="flex flex-col flex-1 min-h-0 px-4 py-2 lg:py-3">
          {/* Header bar */}
          <div
            className="chat-page-header flex justify-between items-center flex-shrink-0"
            style={{
              maxWidth: isDesktop ? 'none' : '48rem',
              width: '100%',
              marginLeft: isDesktop ? undefined : 'auto',
              marginRight: isDesktop ? undefined : 'auto',
              marginBottom: '0.375rem',
            }}
          >
            <h2
              className="chat-page-title font-display text-lg font-bold"
              style={{
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.02em',
                fontFamily: 'var(--font-display)',
              }}
            >
              AI Creative Studio
            </h2>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Upload error */}
          {uploadError && (
            <div
              className="card-premium px-5 py-3 flex-shrink-0"
              style={{
                background: 'rgba(239, 68, 68, 0.05)',
                borderColor: 'rgba(239, 68, 68, 0.2)',
                color: '#dc2626',
                maxWidth: isDesktop ? 'none' : '48rem',
                width: '100%',
                marginLeft: isDesktop ? undefined : 'auto',
                marginRight: isDesktop ? undefined : 'auto',
              }}
            >
              {uploadError}
            </div>
          )}

          {/* Main content: sidebar + chat panel */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              gap: 0,
              maxWidth: isDesktop ? 'none' : '48rem',
              width: '100%',
              marginLeft: isDesktop ? undefined : 'auto',
              marginRight: isDesktop ? undefined : 'auto',
            }}
          >
            {/* Desktop sidebar */}
            {isDesktop && (
              <ChatHistorySidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                getThumbnailUrl={getThumbnailUrl}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onNewProject={handleUploadClick}
                onFileDrop={handleFileDrop}
                unreadSessionIds={unreadSessionIds}
                activeJobSessionIds={activeJobSessionIds}
              />
            )}

            {/* Chat panel */}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              <ChatPanel
                sogniClient={sogniClient}
                imageData={imageData}
                imageUrl={imageUrl}
                width={width}
                height={height}
                tokenType={tokenType}
                balances={balances}
                isAuthenticated={isAuthenticated}
                chat={chat}
                qualityTier={qualityTier}
                onQualityTierChange={setQualityTier}
                estimatedCost={estimatedCost}
                costLoading={costLoading}
                allowAutoAnalysis={sessionsInitialized && !pendingRestore}
                onResultsChange={handleResultsChange}
                onLoadingChange={handleLoadingChange}
                onUploadClick={handleUploadClick}
                onTokenSwitch={handleTokenSwitch}
                onInsufficientCredits={handleInsufficientCredits}
                onClearAll={handleNewPhoto}
                onOpenDrawer={!isDesktop ? () => setDrawerOpen(true) : undefined}
                downloadSlug={slugify(sessionTitleRef.current)}
                uploadedFiles={uploadedFiles}
                isMediaUploading={isMediaUploading}
                mediaUploadError={mediaUploadError}
                onAddMediaFile={addMediaFile}
                onRemoveMediaFile={removeMediaFile}
                onClearMediaFiles={clearMediaFiles}
                onFileDrop={handleFileDrop}
              />
            </div>
          </div>
        </div>

        {/* Mobile chat history drawer */}
        {!isDesktop && drawerOpen && (
          <MobileChatDrawer
            sessions={sessions}
            activeSessionId={activeSessionId}
            getThumbnailUrl={getThumbnailUrl}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onNewProject={handleUploadClick}
            onFileDrop={handleFileDrop}
            onClose={() => setDrawerOpen(false)}
            unreadSessionIds={unreadSessionIds}
            activeJobSessionIds={activeJobSessionIds}
          />
        )}

        {/* Footer only when no image — hidden on mobile to keep input visible */}
        {!imageUrl && <div className="chat-footer-wrap"><Footer /></div>}
      </main>
    </>
  );
}
