/**
 * Chat page — primary interface for Sogni Creative Agent.
 * Full-width conversational interface for AI-assisted photo operations.
 * Owns useChat state and passes it down to ChatPanel.
 * Integrates chat history sidebar on desktop (>=900px).
 */
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSogniAuth } from '@/services/sogniAuth';
import { useWallet } from '@/hooks/useWallet';
import { useMediaUpload } from '@/hooks/useMediaUpload';
import { useChat, getWelcomeGreeting } from '@/hooks/useChat';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useLayout } from '@/layouts/AppLayout';
import { useToastContext } from '@/context/ToastContext';
import { SEOHead } from '@/components/seo/SEOHead';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { usePersonas } from '@/hooks/usePersonas';
import { PersonaEditorPanel } from '@/components/personas/PersonaEditorPanel';
import { getPersona } from '@/utils/userDataDB';
import type { Persona } from '@/types/userData';
// Footer removed for clean ChatGPT-inspired layout
import { saveRestorationToGallery } from '@/services/galleryService';
import { generateSessionTitle } from '@/services/chatService';
import { slugify } from '@/utils/downloadFilename';
import { fetchImageAsUint8Array, fetchAudioAsUint8Array } from '@/tools/shared/sourceImage';
import type { ChatSession, UIChatMessage } from '@/types/chat';
import type { UploadedFile } from '@/tools/types';
import type { QualityTier } from '@/config/qualityPresets';
import { CHAT_MODEL_ABLITERATED } from '@/config/chat';
import { DEFAULT_VARIANT_ID } from '@/config/modelVariants';
import { QUALITY_PRESETS, getSavedQualityTier, saveQualityTier } from '@/config/qualityPresets';
import type { TokenType } from '@/types/wallet';
import { SogniTVPreview } from '@/components/shared/SogniTVPreview';
import { warmUpAudio } from '@/utils/sonicLogos';
import { projectSessionMap } from '@/services/projectSessionMap';
import '@/components/chat/chat.css';

// Pre-compiled regexes for title detection — avoids re-compiling on every call
const RE_TITLE_NUMERIC = /^\d[\d\s_-]*$/;
const RE_TITLE_GENERIC = /^(images?|photos?|downloads?|pictures?|files?|untitled|screenshot)([\s_-]*\(?\d+\)?)?$/i;
const RE_TITLE_NON_ALNUM = /[^a-zA-Z0-9]/g;
const RE_TITLE_DIGIT = /\d/g;
const RE_CAMERA_PATTERN = /^[A-Z]{0,4}[-_\s]?\d{3,}[-_\s\d]*$/i;

/** Returns true if a title is predominantly numeric or a known placeholder — not human-readable */
function isGenericTitle(title: string): boolean {
  if (!title) return true;
  if (title === 'New Photo' || title.startsWith('Photo Restore') || title.startsWith('New Session')) return true;
  if (RE_TITLE_NUMERIC.test(title.trim())) return true;
  if (RE_TITLE_GENERIC.test(title.trim())) return true;
  const alphanumeric = title.replace(RE_TITLE_NON_ALNUM, '');
  if (alphanumeric.length > 0) {
    const digitCount = (title.match(RE_TITLE_DIGIT) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return true;
  }
  return false;
}

/** Generate a clean session title, preferring analysis text over raw filenames */
function deriveSessionTitle(filename?: string, sessionNumber?: number): string {
  const placeholder = sessionNumber ? `New Session #${sessionNumber}` : 'New Session';
  if (!filename) return placeholder;
  const base = filename.replace(/\.[^.]+$/, '');
  if (RE_CAMERA_PATTERN.test(base)) return placeholder;
  if (RE_TITLE_GENERIC.test(base.trim())) return placeholder;
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const alphanumeric = cleaned.replace(RE_TITLE_NON_ALNUM, '');
  if (alphanumeric.length > 0) {
    const digitCount = (cleaned.match(RE_TITLE_DIGIT) || []).length;
    if (digitCount / alphanumeric.length > 0.6) return placeholder;
  }
  return cleaned || placeholder;
}

/** Construct UploadedFile array from legacy session fields for backward compat.
 *  Filters out persona reference photos that may have leaked into saved sessions. */
function legacySessionToUploadedFiles(session: ChatSession): UploadedFile[] {
  if (session.uploadedFiles?.length) {
    return session.uploadedFiles.filter(f => !f.filename?.startsWith('persona-'));
  }
  if (!session.imageData || !session.width || !session.height) return [];
  return [{
    type: 'image',
    data: session.imageData,
    width: session.width,
    height: session.height,
    mimeType: 'image/jpeg',
    filename: 'restored-image.jpg',
  }];
}


export default function ChatPage() {
  const { isAuthenticated, getSogniClient, user } = useSogniAuth();
  const { tokenType, balances, switchPaymentMethod } = useWallet();
  const {
    uploadedFiles,
    isUploading: isMediaUploading,
    error: mediaUploadError,
    addFile: addMediaFile,
    removeFile: removeMediaFile,
    clearFiles: clearMediaFiles,
    loadFiles,
    getPreviewUrl,
    clearError: clearMediaUploadError,
  } = useMediaUpload();

  // Derive primary image data from uploadedFiles for backward compat with existing consumers
  const primaryImage = useMemo(() => {
    if (!uploadedFiles || uploadedFiles.length === 0) return null;
    return uploadedFiles.find(f => f.type === 'image') ?? null;
  }, [uploadedFiles]);
  const primaryImageIndex = useMemo(() => {
    if (!primaryImage || !uploadedFiles) return -1;
    return uploadedFiles.indexOf(primaryImage);
  }, [primaryImage, uploadedFiles]);
  const imageData = primaryImage?.data ?? null;
  const width = primaryImage?.width || 1024;
  const height = primaryImage?.height || 1024;
  const imageUrl = useMemo(() => {
    if (primaryImageIndex < 0) return null;
    return getPreviewUrl(primaryImageIndex);
  }, [primaryImageIndex, getPreviewUrl]);

  const chat = useChat();
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createNewSession,
    switchSession,
    deleteSessionById,
    saveCurrentSession,
    updateThumbnail,
    renameSession,
    togglePinSession,
    refreshSessions,
    initialized: sessionsInitialized,
    pendingRestore,
    clearPendingRestore,
  } = useChatSessions();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const { showOutOfCreditsPopup, showSignupModal, sidebarCollapsed, toggleSidebar, selectedModelVariant, setSelectedModelVariant, safeContentFilter, setSafeContentFilter, isLoginModalOpen } = useLayout();
  const { personas, addPersona, updatePersona, deletePersona, getPersonaThumbnailUrl } = usePersonas();
  const [personaEditorOpen, setPersonaEditorOpen] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const { showToast } = useToastContext();

  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Background job tracking: which sessions have running jobs, which have unread results
  const [activeJobSessionIds, setActiveJobSessionIds] = useState<Set<string>>(new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(new Set());
  const [uploadIntent, setUploadIntent] = useState<'edit' | 'video' | 'restore' | null>(null);
  const [qualityTier, setQualityTierState] = useState<QualityTier>(getSavedQualityTier);
  const setQualityTier = useCallback((tier: QualityTier) => {
    setQualityTierState(tier);
    saveQualityTier(tier);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gallerySavedRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTitleRef = useRef<string>('New Session');
  const sessionCreatedAtRef = useRef<number>(Date.now());
  const sessionUpdatedAtRef = useRef<number>(Date.now());
  const sessionPinnedRef = useRef<boolean | undefined>(undefined);
  const sessionDirtyRef = useRef(false);
  const isRestoringRef = useRef(false);
  const generatingTitleRef = useRef(false);
  const userRenamedRef = useRef(false);

  // Keep refs for save function dependencies so effects don't re-run on every render
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const uploadedFilesRef = useRef(uploadedFiles);
  uploadedFilesRef.current = uploadedFiles;

  // Personalize welcome message when user/personas load
  const selfPersonaName = useMemo(() => {
    const self = personas.find(p => p.relationship === 'self');
    return self?.name || null;
  }, [personas]);

  const welcomeUserName = selfPersonaName || user?.username || null;

  // Stable greeting per mount — re-rolls only when the name changes
  const welcomeGreeting = useMemo(
    () => getWelcomeGreeting(welcomeUserName),
    [welcomeUserName],
  );

  useEffect(() => {
    chat.updateWelcome({
      userName: welcomeUserName,
      hasPersonas: personas.length > 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfPersonaName, user?.username, personas.length, chat.updateWelcome]);

  // Track counts for immediate save when new content is generated
  const prevResultCountRef = useRef(0);
  const prevVideoCountRef = useRef(0);
  const prevMsgCountRef = useRef(0);
  const prevGalleryIdCountRef = useRef(0);
  const prevChatIsLoadingRef = useRef(false);

  // (Auth check moved to early return below — no redirect needed since ChatPage IS "/")

  // Clean up orphaned IndexedDB from removed useImageUpload hook
  useEffect(() => {
    indexedDB.deleteDatabase('sogni_chat_image');
  }, []);

  // Keep useChat's sessionIdRef in sync with the active session
  const { loadFromSession, setSessionId, setOnBackgroundComplete, setOnBackgroundGallerySaved, attachRecoveryListeners, setOnRecoveryToast } = chat;

  // Clean up stale project→session mappings on startup (older than 24h)
  useEffect(() => {
    projectSessionMap.cleanup();
  }, []);

  // Attach SDK recovery listeners once the client is available
  useEffect(() => {
    const client = getSogniClient();
    if (!client) return;
    const cleanup = attachRecoveryListeners(client);
    return cleanup;
  }, [getSogniClient, attachRecoveryListeners]);

  // Wire recovery toast notifications to the app's toast system
  useEffect(() => {
    setOnRecoveryToast((message) => {
      showToast({ message, type: 'info' });
    });
    return () => setOnRecoveryToast(null);
  }, [setOnRecoveryToast, showToast]);

  useEffect(() => {
    setSessionId(activeSessionId);
  }, [activeSessionId, setSessionId]);
  useEffect(() => {
    if (!pendingRestore) return;
    isRestoringRef.current = true;
    const videoMsgCount = pendingRestore.uiMessages.filter(m => m.videoResults?.length).length;
    const videoUrlCount = pendingRestore.uiMessages.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const galleryVideoIdCount = pendingRestore.uiMessages.filter(m => m.galleryVideoIds?.length).length;
    console.log(`[CHAT PAGE] Restoring session: ${pendingRestore.uiMessages.length} msgs, ${videoMsgCount} with videos (${videoUrlCount} urls), ${galleryVideoIdCount} with gallery video IDs, uploadedFiles=${pendingRestore.uploadedFiles?.length || 0}`);
    loadFromSession(pendingRestore);
    // Sync model selector with session's model override
    if (pendingRestore.sessionModel === CHAT_MODEL_ABLITERATED) {
      setSelectedModelVariant('unrestricted');
    } else if (!pendingRestore.sessionModel) {
      setSelectedModelVariant(DEFAULT_VARIANT_ID);
    }
    setSessionId(pendingRestore.id);
    sessionTitleRef.current = pendingRestore.title;
    sessionCreatedAtRef.current = pendingRestore.createdAt;
    sessionUpdatedAtRef.current = pendingRestore.updatedAt;
    sessionPinnedRef.current = pendingRestore.pinned;
    userRenamedRef.current = false;
    sessionDirtyRef.current = false;
    gallerySavedRef.current = pendingRestore.allResultUrls.length > 0;
    setResultUrls(pendingRestore.allResultUrls);
    // Restore uploaded files from session (with backward compat for legacy imageData sessions)
    loadFiles(legacySessionToUploadedFiles(pendingRestore));
    clearPendingRestore();
    // Allow saves again after state settles (must exceed 1500ms debounce)
    const timer = setTimeout(() => { isRestoringRef.current = false; }, 2000);
    return () => clearTimeout(timer);
  }, [pendingRestore, loadFromSession, setSessionId, setSelectedModelVariant, loadFiles, clearPendingRestore]);

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
      pinned: sessionPinnedRef.current,
      uiMessages: state.uiMessages,
      conversation: state.conversation,
      allResultUrls: state.allResultUrls,
      audioResultUrls: state.audioResultUrls,
      analysisSuggestions: state.analysisSuggestions,
      sessionModel: state.sessionModel,
      // Filter out persona reference photos injected by resolve_personas — they're
      // loaded fresh from IndexedDB each time and should not persist in the session.
      uploadedFiles: uploadedFilesRef.current?.filter(f => !f.filename?.startsWith('persona-')),
    };

    const msgsWithVideos = state.uiMessages.filter(m => m.videoResults?.length);
    const totalVideoUrls = state.uiMessages.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const msgsWithGalleryVideoIds = state.uiMessages.filter(m => m.galleryVideoIds?.length);
    console.log(`[CHAT PAGE] saveActiveSession: id=${id}, dirty=${sessionDirtyRef.current}, ${state.uiMessages.length} msgs, ${state.allResultUrls.length} allResultUrls, ${state.uiMessages.filter(m => m.imageResults?.length).length} msgs with images, ${msgsWithVideos.length} msgs with videos (${totalVideoUrls} urls), ${msgsWithGalleryVideoIds.length} msgs with gallery video IDs, uploadedFiles=${uploadedFilesRef.current?.length || 0}`);
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

  // Count gallery IDs so saves trigger when video/audio gallery IDs arrive via onGallerySaved
  const galleryIdCount = useMemo(() =>
    chat.messages.reduce((count, msg) =>
      count + (msg.galleryImageIds?.length || 0) + (msg.galleryVideoIds?.length || 0) + (msg.galleryAudioIds?.length || 0), 0),
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

    // Detect chat round completion (loading went from true to false).
    // Save immediately so text-only conversations don't rely solely on
    // the 1500ms debounce — which may not fire before a page refresh.
    const wasLoading = prevChatIsLoadingRef.current;
    prevChatIsLoadingRef.current = chatIsLoading;
    if (wasLoading && !chatIsLoading && activeSessionId && sessionDirtyRef.current && !isRestoringRef.current) {
      saveActiveSession();
      return; // skip the debounce — we just saved
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
      const mimeType = primaryImage?.mimeType || 'image/jpeg';
      saveRestorationToGallery({
        sourceImageBlob: new Blob([imageData as BlobPart], { type: mimeType }),
        sourceFilename: primaryImage?.filename || `source-${Date.now()}.jpg`,
        sourceWidth: width,
        sourceHeight: height,
        sourceMimeType: mimeType,
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
  }, [resultUrls, chatLoading, imageData, width, height, primaryImage, qualityTier, saveActiveSession]);

  // Update thumbnail when image is available for the active session
  useEffect(() => {
    if (activeSessionId && imageData) {
      const mimeType = primaryImage?.mimeType || 'image/jpeg';
      const blob = new Blob([imageData as BlobPart], { type: mimeType });
      updateThumbnail(activeSessionId, blob);
    }
  }, [activeSessionId, imageData, primaryImage, updateThumbnail]);

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

    setOnBackgroundGallerySaved(async (sessionId, galleryImageIds, galleryVideoIds, galleryAudioIds) => {
      console.log(`[CHAT PAGE] Background gallery saved for session ${sessionId}: ${galleryImageIds.length} images, ${galleryVideoIds.length} videos, ${galleryAudioIds?.length || 0} audio`);

      const { updateSessionMessages } = await import('@/utils/chatHistoryDB');
      const { applyGalleryIdsToMessages } = await import('@/hooks/useChat');
      await updateSessionMessages(sessionId, (messages) =>
        applyGalleryIdsToMessages(messages, galleryImageIds, galleryVideoIds, galleryAudioIds),
      );
    });
  }, [setOnBackgroundComplete, setOnBackgroundGallerySaved, showToast]);

  // Auto-name session from analysis text via LLM, or first user text message.
  // Wait until the message is fully streamed before generating a title.
  useEffect(() => {
    if (userRenamedRef.current) return;
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
    if (!sessionsInitialized || pendingRestore || isRestoringRef.current) return;
    if (activeSessionId) return;
    // Wait until there's something worth saving (more than welcome msg)
    if (chat.messages.length > 1) {
      const newId = createNewSession();
      sessionCreatedAtRef.current = Date.now();
      setActiveSessionId(newId);
      // Update ref immediately so saveActiveSession can use it before next render
      activeSessionIdRef.current = newId;
      sessionDirtyRef.current = true;
      // Save to IndexedDB right away — don't wait for the debounce timer.
      // Without this, refreshing before the first debounced save loses the session
      // (sessionStorage has the ID but IndexedDB has no data).
      saveActiveSession();
    }
  }, [sessionsInitialized, pendingRestore, activeSessionId, chat.messages, createNewSession, setActiveSessionId, saveActiveSession]);

  const handleResultsChange = useCallback((urls: string[]) => {
    setResultUrls(urls);
  }, []);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setChatLoading(loading);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        await addMediaFile(file);
      }
    },
    [addMediaFile],
  );

  const handleUploadClick = useCallback((intent?: 'edit' | 'video' | 'restore') => {
    warmUpAudio(); // Pre-warm audio context for iOS
    setUploadIntent(intent ?? 'edit');
    // Reset value so re-selecting the same file still triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }, []);

  const handleFileDrop = useCallback(
    async (file: File) => {
      // Same flow as handleFileSelect but accepts a File directly (for drag-and-drop)
      // Drag-drop has no explicit intent — default to 'edit'
      setUploadIntent('edit');
      if (activeSessionIdRef.current) await saveActiveSession();

      // Track background jobs before resetting
      if (chatRef.current.isLoading || chatRef.current.isSending) {
        const currentId = activeSessionIdRef.current;
        if (currentId) setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
      }

      isRestoringRef.current = true;
      clearMediaFiles();
      setResultUrls([]);
      gallerySavedRef.current = false;
      chat.reset({ keepBackground: true });
      sessionTitleRef.current = deriveSessionTitle(file.name, sessions.length + 1);
      sessionCreatedAtRef.current = Date.now();
      sessionUpdatedAtRef.current = Date.now();
      sessionPinnedRef.current = undefined;
      userRenamedRef.current = false;
      sessionDirtyRef.current = false;
      setActiveSessionId(null);
      setTimeout(() => { isRestoringRef.current = false; }, 2000);

      await addMediaFile(file);
    },
    [addMediaFile, saveActiveSession, clearMediaFiles, chat, setActiveSessionId, sessions.length],
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
    clearMediaFiles();
    setResultUrls([]);
    setUploadIntent(null);
    gallerySavedRef.current = false;
    chat.reset({ keepBackground: true });
    sessionTitleRef.current = `New Session #${sessions.length + 1}`;
    sessionCreatedAtRef.current = Date.now();
    sessionUpdatedAtRef.current = Date.now();
    sessionPinnedRef.current = undefined;
    userRenamedRef.current = false;
    sessionDirtyRef.current = false;
    setActiveSessionId(null);
    // Short timeout: just enough for React state to settle after reset.
    // No IndexedDB load here (unlike session switching), so 2s is too long
    // — it blocks session creation when the user sends a message immediately.
    setTimeout(() => { isRestoringRef.current = false; }, 100);
  }, [clearMediaFiles, chat, saveActiveSession, setActiveSessionId, sessions.length]);

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
    // Sync model selector with session's model override
    if (session.sessionModel === CHAT_MODEL_ABLITERATED) {
      setSelectedModelVariant('unrestricted');
    } else if (!session.sessionModel) {
      setSelectedModelVariant(DEFAULT_VARIANT_ID);
    }
    sessionTitleRef.current = session.title;
    sessionCreatedAtRef.current = session.createdAt;
    sessionUpdatedAtRef.current = session.updatedAt;
    sessionPinnedRef.current = session.pinned;
    userRenamedRef.current = false;
    sessionDirtyRef.current = false;
    // Mark gallery as already saved for restored sessions to prevent duplicate saves
    gallerySavedRef.current = session.allResultUrls.length > 0;
    setResultUrls(session.allResultUrls);

    // Restore uploaded files (with backward compat for legacy imageData sessions)
    loadFiles(legacySessionToUploadedFiles(session));

    // Switching sessions clears any pending upload intent
    setUploadIntent(null);

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
  }, [saveActiveSession, switchSession, chat, loadFiles, setSelectedModelVariant]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const isActive = id === activeSessionIdRef.current;

    // Suppress saves during delete to prevent phantom session creation
    isRestoringRef.current = true;

    if (isActive) {
      // Clear active session BEFORE deleting to prevent saves of stale state
      setActiveSessionId(null);
      clearMediaFiles();
      setResultUrls([]);
      gallerySavedRef.current = false;
      chat.reset();
      sessionTitleRef.current = `New Session #${sessions.length + 1}`;
      sessionCreatedAtRef.current = Date.now();
      sessionUpdatedAtRef.current = Date.now();
      sessionPinnedRef.current = undefined;
      userRenamedRef.current = false;
      sessionDirtyRef.current = false;
    }

    await deleteSessionById(id);

    // Clean up background indicators for deleted session
    setActiveJobSessionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setUnreadSessionIds((prev) => { const next = new Set(prev); next.delete(id); return next; });

    setTimeout(() => { isRestoringRef.current = false; }, 2000);
  }, [deleteSessionById, clearMediaFiles, chat, setActiveSessionId, sessions.length]);

  const handleRenameSession = useCallback(async (id: string, newTitle: string) => {
    if (id === activeSessionIdRef.current) {
      // For the active session, update the ref and trigger a save through the normal path.
      // This avoids a race between updateSessionFields and saveActiveSession.
      sessionTitleRef.current = newTitle;
      userRenamedRef.current = true;
      sessionDirtyRef.current = true;
      saveActiveSession();
      // Still refresh sidebar so the new title appears immediately
      await refreshSessions();
    } else {
      // For inactive sessions, update IndexedDB directly
      await renameSession(id, newTitle);
    }
  }, [renameSession, saveActiveSession, refreshSessions]);

  const handleTogglePinSession = useCallback(async (id: string) => {
    const newPinned = await togglePinSession(id);
    // Update the local ref so saveActiveSession preserves the new state
    if (id === activeSessionIdRef.current) {
      sessionPinnedRef.current = newPinned;
    }
  }, [togglePinSession]);

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

  /** Branch conversation at a specific message into a new chat session */
  const handleBranchChat = useCallback(async (message: UIChatMessage) => {
    // Track background jobs if current session has running tools
    if (chatRef.current.isLoading || chatRef.current.isSending) {
      const currentId = activeSessionIdRef.current;
      if (currentId) {
        setActiveJobSessionIds((prev) => new Set(prev).add(currentId));
      }
    }

    // Kill any pending debounced save so it can't race with the new session
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // Save current session first
    if (activeSessionIdRef.current) await saveActiveSession();

    isRestoringRef.current = true;

    // Fetch artifact(s) from the message and convert to UploadedFiles.
    // This creates a brand-new chat with the artifact loaded as an upload —
    // no conversation history, no LLM memory, just a clean slate.
    const branchedFiles: UploadedFile[] = [];
    const branchedResultUrls: string[] = [];
    const branchedAudioUrls: string[] = [];

    if (message.imageResults?.length) {
      for (const url of message.imageResults) {
        try {
          const fetched = await fetchImageAsUint8Array(url);
          const ext = fetched.mimeType === 'image/png' ? 'png' : 'jpg';
          branchedFiles.push({
            type: 'image',
            data: fetched.data,
            width: fetched.width,
            height: fetched.height,
            mimeType: fetched.mimeType,
            filename: `image-${branchedFiles.length + 1}.${ext}`,
          });
          branchedResultUrls.push(url);
        } catch (err) {
          console.error('[BRANCH] Failed to fetch image:', err);
        }
      }
    }

    if (message.audioResults?.length) {
      for (const url of message.audioResults) {
        try {
          const { data, mimeType } = await fetchAudioAsUint8Array(url);
          const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('flac') ? 'flac' : 'mp3';
          branchedFiles.push({
            type: 'audio',
            data,
            mimeType,
            filename: `audio-${branchedFiles.length + 1}.${ext}`,
          });
          branchedResultUrls.push(url);
          branchedAudioUrls.push(url);
        } catch (err) {
          console.error('[BRANCH] Failed to fetch audio:', err);
        }
      }
    }

    if (message.videoResults?.length) {
      for (const url of message.videoResults) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('content-type') || 'video/mp4';
          const ext = contentType.includes('webm') ? 'webm' : 'mp4';
          branchedFiles.push({
            type: 'video',
            data: new Uint8Array(buffer),
            mimeType: contentType,
            filename: `video-${branchedFiles.length + 1}.${ext}`,
          });
        } catch (err) {
          console.error('[BRANCH] Failed to fetch video:', err);
        }
      }
    }

    // Create a clean new session — no messages, no conversation history
    const newId = createNewSession();
    const baseTitle = (sessionTitleRef.current || 'Chat').replace(/ \(branch\)$/, '');
    const branchedTitle = baseTitle + ' (branch)';
    const newSession: ChatSession = {
      id: newId,
      title: branchedTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      uiMessages: [],
      conversation: [],
      allResultUrls: [...new Set(branchedResultUrls)],
      audioResultUrls: branchedAudioUrls.length > 0 ? [...new Set(branchedAudioUrls)] : undefined,
      analysisSuggestions: [],
      uploadedFiles: branchedFiles,
    };

    await saveCurrentSession(newId, newSession);

    // Point everything at the new session BEFORE loading state.
    // Using setActiveSessionId directly (instead of switchSession) avoids an
    // unnecessary IndexedDB round-trip and removes a window where the state
    // and ref could momentarily disagree.
    setActiveSessionId(newId);
    activeSessionIdRef.current = newId;

    // Load the clean session into useChat — must happen in the same
    // synchronous block as the ID updates so React batches everything
    // into a single render with (newId + empty messages).
    chat.loadFromSession(newSession);

    // Reset to default model variant for the fresh session
    setSelectedModelVariant(DEFAULT_VARIANT_ID);

    sessionTitleRef.current = branchedTitle;
    sessionCreatedAtRef.current = newSession.createdAt;
    sessionUpdatedAtRef.current = newSession.updatedAt;
    sessionPinnedRef.current = undefined;
    userRenamedRef.current = false;
    sessionDirtyRef.current = false;
    // Artifacts came from a session that already saved to gallery — skip re-save
    gallerySavedRef.current = true;
    setResultUrls(newSession.allResultUrls);
    setUploadIntent(null);

    // Load the fetched artifacts as uploaded files
    loadFiles(branchedFiles);

    console.log(`[BRANCH] Created clean session ${newId}: 0 msgs, ${branchedFiles.length} files, ${branchedResultUrls.length} result URLs`);

    setTimeout(() => { isRestoringRef.current = false; }, 2000);
  }, [chat, createNewSession, saveCurrentSession, setActiveSessionId, saveActiveSession, setSelectedModelVariant, loadFiles]);

  /** Retry a tool execution with an optional model override */
  const handleRetry = useCallback(async (message: UIChatMessage, modelKey?: string) => {
    const client = getSogniClient();
    if (!client) return;
    await chat.retryToolExecution(message, {
      sogniClient: client,
      imageData,
      width,
      height,
      tokenType,
      balances,
      qualityTier,
      safeContentFilter,
      onContentFilterChange: setSafeContentFilter,
      uploadedFiles,
      onTokenSwitch: handleTokenSwitch,
      onInsufficientCredits: handleInsufficientCredits,
      modelVariantId: selectedModelVariant,
    }, modelKey);
  }, [chat, getSogniClient, imageData, width, height, tokenType, balances, qualityTier, safeContentFilter, setSafeContentFilter, uploadedFiles, handleTokenSwitch, handleInsufficientCredits, selectedModelVariant]);

  const sogniClient = getSogniClient();

  const handleAddPersona = useCallback(() => {
    setEditingPersonaId(null);
    setEditingPersona(null);
    setPersonaEditorOpen(true);
    setDrawerOpen(false);
  }, []);

  const handleEditPersona = useCallback(async (id: string) => {
    try {
      const persona = await getPersona(id);
      setEditingPersonaId(id);
      setEditingPersona(persona);
      setPersonaEditorOpen(true);
      setDrawerOpen(false);
    } catch (err) {
      console.error('[CHAT PAGE] Failed to load persona for editing:', err);
    }
  }, []);

  const handleSavePersona = useCallback(async (persona: Persona, faceCropBlob?: Blob | null) => {
    if (editingPersonaId) {
      await updatePersona(persona, faceCropBlob);
    } else {
      await addPersona(persona, faceCropBlob);
    }
  }, [editingPersonaId, updatePersona, addPersona]);

  if (!isAuthenticated) {
    return (
      <>
        <SEOHead
          title="Sogni Chat — Your Creative AI Agent"
          description="Chat with AI to generate images, create videos, compose music, restore photos, and more."
          path="/"
        />
        <main className="flex-1 flex items-center justify-center page-enter">
          <div className="text-center px-6" style={{ maxWidth: '32rem' }}>
            <h1
              className="text-3xl font-semibold mb-3"
              style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}
            >
              {welcomeGreeting}
            </h1>
            <p className="mb-8" style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.6, fontSize: '0.9375rem' }}>
              Generate images and videos, compose music, restore and transform photos — with the power of your Sogni Creative Agent.
            </p>
            <button
              onClick={() => showSignupModal()}
              className="btn-primary px-6 py-3 font-semibold text-base"
              style={{
                cursor: 'pointer',
              }}
            >
              Sign In to Get Started
            </button>
          </div>
        </main>
        {!isLoginModalOpen && <SogniTVPreview />}
      </>
    );
  }

  return (
    <>
      <SEOHead
        title="Sogni Chat — Your Creative AI Agent"
        description="Chat with AI to generate images, create videos, compose music, restore photos, and more."
        path="/"
      />
      {/* Desktop sidebar — rendered via portal into AppLayout so it spans full viewport height */}
      {isDesktop && document.getElementById('sidebar-root') && createPortal(
        <ChatHistorySidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onTogglePinSession={handleTogglePinSession}
          onNewProject={handleNewPhoto}
          onFileDrop={handleFileDrop}
          unreadSessionIds={unreadSessionIds}
          activeJobSessionIds={activeJobSessionIds}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          personas={personas}
          onAddPersona={handleAddPersona}
          onEditPersona={handleEditPersona}
          getPersonaThumbnailUrl={getPersonaThumbnailUrl}
        />,
        document.getElementById('sidebar-root')!,
      )}

      {/* Full-height flex row: main content */}
      <div className="flex flex-1 min-h-0 page-enter">
        {/* Main content column */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

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
              safeContentFilter={safeContentFilter}
              onContentFilterChange={setSafeContentFilter}

              onResultsChange={handleResultsChange}
              onLoadingChange={handleLoadingChange}
              onUploadClick={handleUploadClick}
              uploadIntent={uploadIntent}
              onTokenSwitch={handleTokenSwitch}
              onInsufficientCredits={handleInsufficientCredits}
              onClearAll={handleNewPhoto}
              onOpenDrawer={!isDesktop ? () => setDrawerOpen(true) : undefined}
              downloadSlug={slugify(sessionTitleRef.current)}
              uploadedFiles={uploadedFiles}
              isMediaUploading={isMediaUploading}
              mediaUploadError={mediaUploadError}
              onClearMediaUploadError={clearMediaUploadError}
              onAddMediaFile={addMediaFile}
              onRemoveMediaFile={removeMediaFile}
              onFileDrop={handleFileDrop}
              hasPersonas={personas.length > 0}
              welcomeGreeting={welcomeGreeting}
              getPreviewUrl={getPreviewUrl}
              onBranchChat={handleBranchChat}
              onRetry={handleRetry}
            />
          </div>
        </div>

        {/* Mobile chat history drawer */}
        {!isDesktop && drawerOpen && (
          <MobileChatDrawer
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onTogglePinSession={handleTogglePinSession}
            onNewProject={handleUploadClick}
            onFileDrop={handleFileDrop}
            onClose={() => setDrawerOpen(false)}
            unreadSessionIds={unreadSessionIds}
            activeJobSessionIds={activeJobSessionIds}
            personas={personas}
            onAddPersona={handleAddPersona}
            onEditPersona={handleEditPersona}
            getPersonaThumbnailUrl={getPersonaThumbnailUrl}
          />
        )}
      </div>

      {/* Persona editor panel */}
      {personaEditorOpen && (
        <PersonaEditorPanel
          persona={editingPersona}
          hasSelfPersona={personas.some(p => p.relationship === 'self')}
          onSave={handleSavePersona}
          onDelete={editingPersonaId ? deletePersona : undefined}
          onClose={() => setPersonaEditorOpen(false)}
          getThumbnailUrl={getPersonaThumbnailUrl}
          sogniClient={sogniClient}
          tokenType={tokenType}
        />
      )}
    </>
  );
}
