/**
 * React hook for managing chat-based restoration assistant state.
 * Session persistence is handled externally by useChatSessions (IndexedDB).
 */
import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { SogniClient } from '@sogni-ai/sogni-client';
import { sendChatMessage, sendVisionAnalysis } from '@/services/chatService';
import type { ToolExecutionContext, ToolExecutionProgress, ToolCallbacks, ToolName, UploadedFile } from '@/tools/types';
import { toolRegistry } from '@/tools/registry';
import { getModelArgKey, isQualityTierTool } from '@/tools/shared/modelRegistry';
import type { TokenType, Balances } from '@/types/wallet';
import type { Suggestion } from '@/utils/chatSuggestions';
import { parseAnalysisSuggestions, stripSuggestTagsForDisplay } from '@/utils/chatSuggestions';
import { resizeImageForVision } from '@/utils/imageProcessing';
import type { ChatSession, UIChatMessage } from '@/types/chat';
import { CHAT_MODEL_ABLITERATED } from '@/config/chat';
import { sogniTVController } from '@/services/sogniTVController';
import { getVariantById } from '@/config/modelVariants';
import { projectSessionMap } from '@/services/projectSessionMap';
import { updateSessionMessages } from '@/utils/chatHistoryDB';

// Re-export UIChatMessage from the canonical location
export type { UIChatMessage } from '@/types/chat';

export interface UseChatResult {
  messages: UIChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  /** True while vision analysis is running and no tokens have arrived yet */
  isAnalyzing: boolean;
  error: string | null;
  /** All result image URLs produced in this chat session */
  allResultUrls: string[];
  /** Suggestions parsed from vision analysis */
  analysisSuggestions: Suggestion[];
  sendMessage: (
    content: string,
    context: {
      sogniClient: SogniClient;
      imageData: Uint8Array | null;
      width: number;
      height: number;
      tokenType: TokenType;
      balances: Balances | null;
      qualityTier?: 'fast' | 'hq';
      safeContentFilter?: boolean;
      onContentFilterChange?: (enabled: boolean) => void;
      uploadedFiles?: UploadedFile[];
      onTokenSwitch?: (newType: TokenType) => void;
      onInsufficientCredits?: () => void;
      modelVariantId?: string;
      uploadedImageUrls?: string[];
    },
  ) => Promise<void>;
  analyzeImage: (context: {
    sogniClient: SogniClient;
    imageUrl: string;
    tokenType: TokenType;
    balances: Balances | null;
    onTokenSwitch?: (newType: TokenType) => void;
    onInsufficientCredits?: () => void;
    visionSystemPrompt?: string;
    visionUserText?: string;
  }) => Promise<void>;
  reset: (options?: { keepBackground?: boolean }) => void;
  /** Cancel the currently running tool execution (e.g. video generation) */
  cancelToolExecution: () => void;
  /** Get a serializable snapshot of current session state */
  getSessionState: () => {
    uiMessages: UIChatMessage[];
    conversation: ChatMessage[];
    allResultUrls: string[];
    audioResultUrls: string[];
    analysisSuggestions: Suggestion[];
    sessionModel?: string;
  };
  /** Replace all state from a loaded ChatSession */
  loadFromSession: (session: ChatSession) => void;
  /** Accept switching to unrestricted model after refusal */
  acceptModelSwitch: () => void;
  /** Decline switching — keep refusal visible */
  declineModelSwitch: () => void;
  /** Whether a model refusal confirmation is pending */
  pendingRefusal: boolean;
  /** Update the welcome message with personalized context (user name, personas) */
  updateWelcome: (ctx: { userName?: string | null; hasPersonas?: boolean; hasImage?: boolean }) => void;
  /** Retry a tool execution directly with optional model override */
  retryToolExecution: (
    message: UIChatMessage,
    context: {
      sogniClient: SogniClient;
      imageData: Uint8Array | null;
      width: number;
      height: number;
      tokenType: TokenType;
      balances: Balances | null;
      qualityTier?: 'fast' | 'hq';
      safeContentFilter?: boolean;
      onContentFilterChange?: (enabled: boolean) => void;
      uploadedFiles?: UploadedFile[];
      onTokenSwitch?: (newType: TokenType) => void;
      onInsufficientCredits?: () => void;
      modelVariantId?: string;
    },
    modelKeyOverride?: string,
  ) => Promise<void>;
  /** Set gallery image/video IDs on messages that have matching results */
  setGalleryIds: (galleryImageIds: string[], galleryVideoIds?: string[]) => void;
  /** Set the current session ID (for background job detection) */
  setSessionId: (id: string | null) => void;
  /** Get the current session ID */
  getSessionId: () => string | null;
  /** Register callback for background job completion */
  setOnBackgroundComplete: (cb: ((
    sessionId: string,
    result: {
      toolName: ToolName;
      resultUrls: string[];
      videoResultUrls?: string[];
      assistantContent: string;
      streamingMsgId: string | null;
    },
  ) => void) | null) => void;
  /** Register callback for background gallery saves */
  setOnBackgroundGallerySaved: (cb: ((
    sessionId: string,
    galleryImageIds: string[],
    galleryVideoIds: string[],
    galleryAudioIds?: string[],
  ) => void) | null) => void;
  /** Dismiss the current error */
  clearError: () => void;
  /** Attach SDK recovery listeners. Call once when sogniClient is available. Returns cleanup fn. */
  attachRecoveryListeners: (sogniClient: SogniClient) => () => void;
  /** Set callback for recovery toast notifications */
  setOnRecoveryToast: (cb: ((message: string) => void) | null) => void;
}

const MAX_CONCURRENT_REQUESTS = 2;


interface WelcomeContext {
  hasImage: boolean;
  userName?: string | null;
  hasPersonas?: boolean;
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Evening';
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

/** Pick a random greeting template for the given name. */
function getRandomGreeting(name: string): string {
  const time = getTimeOfDayGreeting();
  const templates = [
    `${time}, ${name}!`,
    `Good ${time.toLowerCase()}, ${name}!`,
    `Hey ${name}!`,
    `Welcome back, ${name}!`,
    `Happy creating, ${name}!`,
    `Ready to create, ${name}?`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/** Build a greeting for the welcome heading (exported for ChatPanel). */
export function getWelcomeGreeting(userName?: string | null): string {
  const name = userName || 'Creator';
  return getRandomGreeting(name);
}

function makeWelcomeMessage(ctx: WelcomeContext | boolean): UIChatMessage {
  // Backward compat: accept plain boolean
  const { hasImage, userName, hasPersonas } = typeof ctx === 'boolean'
    ? { hasImage: ctx, userName: undefined, hasPersonas: undefined }
    : ctx;

  const greeting = getRandomGreeting(userName || 'Creator');

  let content: string;
  if (hasImage) {
    content = `${greeting} I can see your photo — I can restore it, apply artistic styles, animate it into a video, change the camera angle, edit details, and more.`;
  } else if (userName) {
    if (hasPersonas === false) {
      content = `${greeting} I can create images, videos, music, and more. Want to personalize your experience? Add yourself in "My Personas" so I can include you in creations.`;
    } else {
      content = `${greeting} What would you like to create?`;
    }
  } else {
    content = `${greeting} What would you like to create?`;
  }

  return {
    id: 'welcome',
    role: 'assistant',
    content,
    timestamp: Date.now(),
  };
}

/** Strip transient fields before persisting.
 *  NOTE: uploadedImageUrl / uploadedImageUrls are intentionally kept — their
 *  stale blob URLs act as markers so the ChatPanel refresh logic can replace
 *  them with fresh blob URLs generated from the persisted uploadedFiles data. */
function cleanForStorage(messages: UIChatMessage[]): UIChatMessage[] {
  return messages.map((msg) => ({
    ...msg,
    toolProgress: undefined,
    isStreaming: undefined,
    streamingStatus: undefined,
    chatModelLabel: undefined,
    isFromHistory: undefined,
  }));
}

/**
 * Apply gallery image/video/audio IDs to the most recent matching messages.
 * Shared by onGallerySaved (video/audio saves) and setGalleryIds (image saves).
 */
export function applyGalleryIdsToMessages(
  messages: UIChatMessage[],
  galleryImageIds: string[],
  galleryVideoIds?: string[],
  galleryAudioIds?: string[],
): UIChatMessage[] {
  const updated = [...messages];
  if (galleryImageIds.length > 0) {
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].imageResults && updated[i].imageResults!.length > 0 && !updated[i].galleryImageIds) {
        updated[i] = { ...updated[i], galleryImageIds };
        break;
      }
    }
  }
  if (galleryVideoIds && galleryVideoIds.length > 0) {
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].videoResults && updated[i].videoResults!.length > 0) {
        // Merge new gallery IDs with any previously saved ones (supports per-job saves)
        const existing = updated[i].galleryVideoIds || [];
        const merged = [...new Set([...existing, ...galleryVideoIds])];
        updated[i] = { ...updated[i], galleryVideoIds: merged };
        break;
      }
    }
  }
  if (galleryAudioIds && galleryAudioIds.length > 0) {
    for (let i = updated.length - 1; i >= 0; i--) {
      if (updated[i].audioResults && updated[i].audioResults!.length > 0) {
        const existing = updated[i].galleryAudioIds || [];
        const merged = [...new Set([...existing, ...galleryAudioIds])];
        updated[i] = { ...updated[i], galleryAudioIds: merged };
        break;
      }
    }
  }
  return updated;
}

export function useChat(): UseChatResult {
  const [uiMessages, setUIMessages] = useState<UIChatMessage[]>([makeWelcomeMessage(false)]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allResultUrls, setAllResultUrls] = useState<string[]>([]);
  const [analysisSuggestions, setAnalysisSuggestions] = useState<Suggestion[]>([]);

  // Persisted welcome context for personalized greetings
  const welcomeContextRef = useRef<WelcomeContext>({ hasImage: false });

  // LLM conversation history (raw ChatMessages for API)
  const conversationRef = useRef<ChatMessage[]>([]);
  // Track all result URLs via ref so tool executions always see the latest state (Fix #4)
  const allResultUrlsRef = useRef<string[]>([]);
  // Track audio result URLs separately (from generate_music) so sound_to_video can find them
  const audioResultUrlsRef = useRef<string[]>([]);
  // Abort handle for cancellation (Fix #8)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  // AbortControllers for active tool executions (so cancel button actually aborts SDK operations)
  const toolAbortControllersRef = useRef<Set<AbortController>>(new Set());
  // Analysis suggestions ref for access in callbacks
  const analysisSuggestionsRef = useRef<Suggestion[]>([]);

  // Model override: once user accepts switch, all subsequent messages use this model
  const sessionModelRef = useRef<string | undefined>(undefined);
  // Pending refusal: stores the message ID that has a refusal, so user can accept/decline
  const [pendingRefusalMsgId, setPendingRefusalMsgId] = useState<string | null>(null);
  // Store the last user message content for resend after model switch
  const lastUserMessageRef = useRef<string>('');
  // Store the last sendMessage context for resend
  const lastSendContextRef = useRef<any>(null);

  // Concurrency: max 2 active requests, queue the rest
  const activeRequestCountRef = useRef(0);
  const queuedRequestsRef = useRef<Array<() => void>>([]);

  // Session ID tracking: when callbacks detect a mismatch, they skip React state
  // updates but still let SDK jobs run to completion in the background.
  const sessionIdRef = useRef<string | null>(null);

  // Callbacks for background job completion (set by ChatPage)
  const onBackgroundCompleteRef = useRef<((
    sessionId: string,
    result: {
      toolName: ToolName;
      resultUrls: string[];
      videoResultUrls?: string[];
      assistantContent: string;
      streamingMsgId: string | null;
    },
  ) => void) | null>(null);

  const onBackgroundGallerySavedRef = useRef<((
    sessionId: string,
    galleryImageIds: string[],
    galleryVideoIds: string[],
    galleryAudioIds?: string[],
  ) => void) | null>(null);

  // Callback for showing recovery toasts (set by parent component)
  const onRecoveryToastRef = useRef<((message: string) => void) | null>(null);

  /**
   * Analyze an uploaded image using vision and stream the analysis into chat.
   * Replaces the welcome message with streamed analysis + parsed suggestion chips.
   */
  const analyzeImage = useCallback(
    async (context: {
      sogniClient: SogniClient;
      imageUrl: string;
      tokenType: TokenType;
      balances: Balances | null;
      onTokenSwitch?: (newType: TokenType) => void;
      onInsufficientCredits?: () => void;
      visionSystemPrompt?: string;
      visionUserText?: string;
    }) => {
      const thisRequest = { aborted: false };
      abortRef.current = thisRequest;
      const capturedSessionId = sessionIdRef.current;
      // If analysis starts before a session ID is assigned (null), stay active
      // as long as this is still the current analysis request (abortRef unchanged).
      // Once a session ID is assigned reactively, the strict equality would fail.
      const isActiveSession = () =>
        capturedSessionId === null
          ? abortRef.current === thisRequest
          : sessionIdRef.current === capturedSessionId;

      setError(null);
      setIsLoading(true);
      setIsAnalyzing(true);

      // Replace welcome message with user-upload image + streaming analysis placeholder
      const analysisMsgId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setUIMessages([
        {
          id: 'user-upload',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          uploadedImageUrl: context.imageUrl,
        },
        {
          id: analysisMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);

      try {
        // Resize image for vision analysis
        const base64DataUri = await resizeImageForVision(context.imageUrl);

        // Accumulate raw content so we can strip [SUGGEST:...] tags during streaming
        let rawAnalysisContent = '';

        const { conversation } = await sendVisionAnalysis(
          context.sogniClient,
          base64DataUri,
          context.tokenType,
          {
            onToken: (token: string) => {
              if (thisRequest.aborted) return;
              if (!isActiveSession()) return;
              setIsAnalyzing(false);
              rawAnalysisContent += token;
              // Strip SUGGEST tags (complete and partial) so they never flash in the UI
              const displayContent = stripSuggestTagsForDisplay(rawAnalysisContent);
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === analysisMsgId
                    ? { ...msg, content: displayContent }
                    : msg,
                ),
              );
            },
            onComplete: (content: string) => {
              if (thisRequest.aborted) return;
              if (!isActiveSession()) return;
              // Parse suggestions from the full raw content
              const { cleanedText, suggestions } = parseAnalysisSuggestions(content);

              // Final cleaned text (should match what was already displayed)
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === analysisMsgId
                    ? { ...msg, content: cleanedText, isStreaming: false }
                    : msg,
                ),
              );

              // Store suggestions
              analysisSuggestionsRef.current = suggestions;
              setAnalysisSuggestions(suggestions);
              setIsAnalyzing(false);
            },
            onError: (errorMsg: string) => {
              if (thisRequest.aborted) return;
              if (!isActiveSession()) return;
              setIsAnalyzing(false);
              setError(errorMsg);
              // Restore welcome message on failure (image was present since we were analyzing)
              setUIMessages([makeWelcomeMessage({ ...welcomeContextRef.current, hasImage: true })]);
            },
          },
          context.visionSystemPrompt || context.visionUserText
            ? { systemPrompt: context.visionSystemPrompt, userText: context.visionUserText }
            : undefined,
        );

        if (!thisRequest.aborted && isActiveSession() && conversation.length > 0) {
          conversationRef.current = conversation;
        }
      } catch (err: any) {
        if (!thisRequest.aborted && isActiveSession()) {
          console.error('[CHAT HOOK] Analyze image error:', err);
          setIsAnalyzing(false);
          setError(err.message || 'Failed to analyze image');
          setUIMessages([makeWelcomeMessage({ ...welcomeContextRef.current, hasImage: true })]);
        }
      } finally {
        if (!thisRequest.aborted && isActiveSession()) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      context: {
        sogniClient: SogniClient;
        imageData: Uint8Array | null;
        width: number;
        height: number;
        tokenType: TokenType;
        balances: Balances | null;
        qualityTier?: 'fast' | 'hq';
        safeContentFilter?: boolean;
        onContentFilterChange?: (enabled: boolean) => void;
        uploadedFiles?: UploadedFile[];
        onTokenSwitch?: (newType: TokenType) => void;
        onInsufficientCredits?: () => void;
        modelVariantId?: string;
        uploadedImageUrls?: string[];
      },
    ) => {
      if (!content.trim()) return;
      setError(null);

      // Add user message to UI immediately (even if queued)
      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const userMsg: UIChatMessage = {
        id: userMsgId,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
        ...(context.uploadedImageUrls?.length ? { uploadedImageUrls: context.uploadedImageUrls } : {}),
      };
      setUIMessages((prev) => [...prev, userMsg]);

      // Add to LLM conversation
      conversationRef.current.push({
        role: 'user',
        content: content.trim(),
      });

      // Store for potential resend if model refuses
      lastUserMessageRef.current = content.trim();
      lastSendContextRef.current = context;

      // Core request execution
      const runRequest = async () => {
        const thisRequest = { aborted: false };
        // Register as the current request so isActiveSession() works when
        // capturedSessionId is null (new chat before session ID assigned).
        // Mirrors the same pattern used in analyzeImage().
        abortRef.current = thisRequest;
        const capturedSessionId = sessionIdRef.current;
        // When capturedSessionId is null (first message before session ID assigned),
        // fall back to checking if this is still the current request via abortRef.
        // Matches the same pattern used in analyzeImage().
        const isActiveSession = () =>
          capturedSessionId === null
            ? abortRef.current === thisRequest
            : sessionIdRef.current === capturedSessionId;

        activeRequestCountRef.current++;
        setIsSending(true);
        setIsLoading(true);

        // Determine model from variant (user dropdown) or session override (abliterated fallback)
        const variant = context.modelVariantId ? getVariantById(context.modelVariantId) : undefined;
        const effectiveModel = sessionModelRef.current
          || (variant ? variant.modelId : undefined);
        const effectiveThink = variant?.think;
        const chatModelLabel = `Sogni Agent · ${variant?.menuLabel || 'Auto'}`;

        // Each request tracks its own streaming message ID
        const localStreamingId: { current: string | null } = {
          current: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        };
        setUIMessages((prev) => [
          ...prev,
          {
            id: localStreamingId.current!,
            role: 'assistant' as const,
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
            streamingStatus: 'Thinking...',
            chatModelLabel,
          },
        ]);

        // Create AbortController for this request's tool executions.
        // Capture the set reference so background jobs clean up correctly
        // even after loadFromSession replaces the set.
        const toolAbortController = new AbortController();
        const controllersSet = toolAbortControllersRef.current;
        controllersSet.add(toolAbortController);

        const executionContext: ToolExecutionContext = {
          sogniClient: context.sogniClient,
          imageData: context.imageData,
          width: context.width,
          height: context.height,
          tokenType: context.tokenType,
          uploadedFiles: context.uploadedFiles || [],
          get resultUrls() { return allResultUrlsRef.current; },
          get audioResultUrls() { return audioResultUrlsRef.current; },
          balances: context.balances,
          qualityTier: context.qualityTier,
          safeContentFilter: context.safeContentFilter,
          onContentFilterChange: context.onContentFilterChange,
          onTokenSwitch: context.onTokenSwitch,
          onInsufficientCredits: context.onInsufficientCredits,
          signal: toolAbortController.signal,
          model: effectiveModel,
          think: effectiveThink,
          sessionId: capturedSessionId || '',
        };

        let accumulatedContent = '';
        let currentToolResultUrls: string[] = [];
        let currentToolVideoUrls: string[] = [];

        try {
          const updatedConversation = await sendChatMessage(
            conversationRef.current,
            executionContext,
            {
              onToken: (token: string) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                accumulatedContent += token;
                const currentContent = accumulatedContent;
                const targetId = localStreamingId.current;
                setUIMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === targetId
                      ? {
                          ...msg,
                          content: currentContent,
                          streamingStatus: undefined,
                          // Clear stale toolProgress when LLM starts streaming.
                          // After a tool error (no onToolComplete), the previous
                          // 'started'/'progress' state persists. Tokens arriving
                          // means the LLM is responding, so any previous tool
                          // progress is stale. (onToken only fires during the
                          // streaming phase, never during tool execution.)
                          toolProgress: null,
                        }
                      : msg,
                  ),
                );
              },

              onToolCall: (toolName: ToolName, toolCallArgs: Record<string, unknown>) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                console.log('[CHAT HOOK] Tool called:', toolName);
                const targetId = localStreamingId.current;
                setUIMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === targetId
                      ? {
                          ...msg,
                          toolArgs: toolCallArgs,
                          toolProgress: {
                            type: 'started',
                            toolName,
                            totalCount: 0,
                            referencedPersonas: msg.toolProgress?.referencedPersonas,
                          },
                        }
                      : msg,
                  ),
                );
              },

              onToolProgress: (progress: ToolExecutionProgress) => {
                if (thisRequest.aborted) return;
                // Push progress to SogniTV overlay (countdown / percentage)
                if (progress.type === 'progress' && progress.progress != null) {
                  sogniTVController.updateProgress({
                    progress: progress.progress,
                    etaSeconds: progress.etaSeconds,
                    toolName: progress.toolName,
                    stepLabel: progress.stepLabel,
                  });
                } else if (progress.type === 'started' || progress.type === 'error' || progress.type === 'completed') {
                  sogniTVController.clearProgress();
                }
                // Always accumulate URLs even for background sessions
                if (progress.type === 'started') {
                  currentToolResultUrls = [];
                  currentToolVideoUrls = [];
                }
                if (progress.resultUrls) {
                  currentToolResultUrls = [
                    ...currentToolResultUrls,
                    ...progress.resultUrls.filter(u => !currentToolResultUrls.includes(u)),
                  ];
                }
                if (progress.videoResultUrls) {
                  const before = currentToolVideoUrls.length;
                  currentToolVideoUrls = [
                    ...currentToolVideoUrls,
                    ...progress.videoResultUrls.filter(u => !currentToolVideoUrls.includes(u)),
                  ];
                  if (currentToolVideoUrls.length > before) {
                    console.log(`[CHAT HOOK] Video URL accumulated: ${before} → ${currentToolVideoUrls.length} (jobIndex=${progress.jobIndex})`);
                  }
                }
                if (!isActiveSession()) return; // Skip React state update for background sessions
                const targetId = localStreamingId.current;

                setUIMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== targetId) return msg;
                    // Reset per-job progress when a new/retried operation starts
                    let perJobProgress = progress.type === 'started'
                      ? undefined
                      : msg.toolProgress?.perJobProgress;
                    if (progress.jobIndex !== undefined) {
                      const prevJob = perJobProgress?.[progress.jobIndex];
                      const resultUrl = progress.videoResultUrls?.[0] || progress.resultUrls?.[0];
                      perJobProgress = {
                        ...perJobProgress,
                        [progress.jobIndex]: {
                          progress: progress.progress ?? prevJob?.progress,
                          etaSeconds: progress.etaSeconds ?? prevJob?.etaSeconds,
                          ...(resultUrl ? { resultUrl } : prevJob?.resultUrl ? { resultUrl: prevJob.resultUrl } : {}),
                          ...(progress.error ? { error: progress.error } : prevJob?.error ? { error: prevJob.error } : {}),
                        },
                      };
                    }
                    // Persist video results progressively so auto-save captures them
                    // even if the batch isn't complete yet (survives page refresh)
                    const videoResults = currentToolVideoUrls.length > 0
                      ? [...new Set(currentToolVideoUrls)]
                      : msg.videoResults;
                    // On retry/restart, clear stale gallery IDs from the previous attempt
                    const galleryVideoIds = progress.type === 'started'
                      ? undefined
                      : msg.galleryVideoIds;
                    // Merge with previous toolProgress so fields from different event types
                    // (e.g. progress from jobStep, etaSeconds from jobETA) don't overwrite each other
                    const prev = msg.toolProgress;
                    const merged: ToolExecutionProgress = progress.type === 'started'
                      ? { ...progress, perJobProgress, referencedPersonas: progress.referencedPersonas ?? prev?.referencedPersonas }
                      : {
                          ...prev,
                          ...progress,
                          // Preserve previous values for fields not present in this event
                          progress: progress.progress ?? prev?.progress,
                          etaSeconds: progress.etaSeconds ?? prev?.etaSeconds,
                          estimatedCost: progress.estimatedCost ?? prev?.estimatedCost,
                          sourceImageUrl: progress.sourceImageUrl ?? prev?.sourceImageUrl,
                          videoAspectRatio: progress.videoAspectRatio ?? prev?.videoAspectRatio,
                          modelName: progress.modelName ?? prev?.modelName,
                          referencedPersonas: progress.referencedPersonas ?? prev?.referencedPersonas,
                          // Accumulate result URLs (each event only carries the latest job's URL)
                          resultUrls: progress.resultUrls
                            ? [...new Set([...(prev?.resultUrls || []), ...progress.resultUrls])]
                            : prev?.resultUrls,
                          perJobProgress,
                        };
                    return { ...msg, toolProgress: merged, videoResults, galleryVideoIds };
                  }),
                );
              },

              onToolComplete: (
                toolName: ToolName,
                resultUrls: string[],
                videoResultUrls?: string[],
              ) => {
                // Close SogniTV if it was auto-opened during rendering
                sogniTVController.notifyToolComplete();

                if (thisRequest.aborted) return;
                if (!isActiveSession()) {
                  // Background completion — notify parent to persist to IndexedDB
                  const allResultUrlsMerged = [...new Set([...currentToolResultUrls, ...resultUrls])];
                  const allVideoUrls = videoResultUrls
                    ? [...new Set([...currentToolVideoUrls, ...videoResultUrls])]
                    : currentToolVideoUrls.length > 0
                      ? [...new Set(currentToolVideoUrls)]
                      : undefined;
                  // Use capturedSessionId, or fall back to current ref (session ID
                  // may have been assigned after tool started but before it completed)
                  const effectiveSessionId = capturedSessionId || sessionIdRef.current;
                  if (effectiveSessionId) {
                    onBackgroundCompleteRef.current?.(effectiveSessionId, {
                      toolName,
                      resultUrls: allResultUrlsMerged,
                      videoResultUrls: allVideoUrls,
                      assistantContent: accumulatedContent,
                      streamingMsgId: localStreamingId.current,
                    });
                  }
                  return;
                }
                currentToolResultUrls = [
                  ...currentToolResultUrls,
                  ...resultUrls.filter(
                    (u) => !currentToolResultUrls.includes(u),
                  ),
                ];
                const uniqueUrls = [...new Set(currentToolResultUrls)];

                // Collect video URLs
                if (videoResultUrls) {
                  currentToolVideoUrls = [
                    ...currentToolVideoUrls,
                    ...videoResultUrls.filter(
                      (u) => !currentToolVideoUrls.includes(u),
                    ),
                  ];
                }
                const uniqueVideoUrls = [...new Set(currentToolVideoUrls)];

                // Add results to the current message
                const currentMsgId = localStreamingId.current;
                const isAudioTool = toolName === 'generate_music';
                setUIMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== currentMsgId) return msg;
                    // Capture fields from toolProgress before clearing it
                    const srcUrl = msg.toolProgress?.sourceImageUrl;
                    const vidAR = msg.toolProgress?.videoAspectRatio;
                    const mdlName = msg.toolProgress?.modelName;
                    const refPersonas = msg.toolProgress?.referencedPersonas;
                    // Extract model key from stored tool args for retry/switch model.
                    // Tools use different arg names: "model", "videoModel", or "quality".
                    const toolModelKey = (msg.toolArgs?.model as string)
                      || (msg.toolArgs?.videoModel as string)
                      || (msg.toolArgs?.quality as string)
                      || undefined;
                    return {
                      ...msg,
                      imageResults: !isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
                      videoResults: uniqueVideoUrls.length > 0 ? uniqueVideoUrls : undefined,
                      audioResults: isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
                      toolProgress: null,
                      sourceImageUrl: srcUrl || undefined,
                      videoAspectRatio: vidAR || undefined,
                      modelName: mdlName || undefined,
                      toolModelKey,
                      lastCompletedTool: toolName,
                      referencedPersonas: refPersonas || msg.referencedPersonas,
                    };
                  }),
                );

                // Update both ref and state for result URLs (Fix #4)
                if (uniqueUrls.length > 0) {
                  const combined = [...new Set([...allResultUrlsRef.current, ...uniqueUrls])];
                  allResultUrlsRef.current = combined;
                  setAllResultUrls(combined);
                }

                // Track audio result URLs separately so sound_to_video can find generated audio
                if (isAudioTool && uniqueUrls.length > 0) {
                  audioResultUrlsRef.current = [
                    ...new Set([...audioResultUrlsRef.current, ...uniqueUrls]),
                  ];
                }

                // After tool completes, the LLM will generate a new response.
                // Create a new assistant message for the post-tool text.
                const postToolMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                localStreamingId.current = postToolMsgId;
                accumulatedContent = '';
                currentToolResultUrls = [];
                currentToolVideoUrls = [];

                setUIMessages((prev) => [
                  ...prev.map((msg) =>
                    msg.id === currentMsgId
                      ? { ...msg, isStreaming: false }
                      : msg,
                  ),
                  {
                    id: postToolMsgId,
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    isStreaming: true,
                    lastCompletedTool: toolName,
                    streamingStatus: 'Thinking...',
                    chatModelLabel,
                  },
                ]);
              },

              onComplete: (_fullContent: string) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                // Mark the current streaming message as done.
                // Also clear any leftover toolProgress — if a tool returned an error
                // without calling onToolComplete, the spinner would persist forever.
                const currentMsgId = localStreamingId.current;
                setUIMessages((prev) => {
                  const updated = prev.map((msg) =>
                    msg.id === currentMsgId
                      ? { ...msg, isStreaming: false, toolProgress: msg.toolProgress ? null : msg.toolProgress }
                      : msg,
                  );
                  // Remove empty assistant messages (but preserve active streaming/tool placeholders from other requests)
                  return updated.filter(
                    (msg) =>
                      msg.role !== 'assistant' ||
                      msg.content.trim() !== '' ||
                      (msg.imageResults && msg.imageResults.length > 0) ||
                      (msg.videoResults && msg.videoResults.length > 0) ||
                      (msg.audioResults && msg.audioResults.length > 0) ||
                      msg.isStreaming ||
                      msg.toolProgress,
                  );
                });
              },

              onError: (errorMsg: string) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                setError(errorMsg);
                const currentMsgId = localStreamingId.current;
                setUIMessages((prev) =>
                  prev
                    .map((msg) =>
                      msg.id === currentMsgId
                        ? { ...msg, isStreaming: false, toolProgress: null }
                        : msg,
                    )
                    .filter(
                      (msg) =>
                        msg.role !== 'assistant' ||
                        msg.content.trim() !== '' ||
                        (msg.imageResults && msg.imageResults.length > 0) ||
                        (msg.videoResults && msg.videoResults.length > 0) ||
                        (msg.audioResults && msg.audioResults.length > 0) ||
                        msg.isStreaming ||
                        msg.toolProgress,
                    ),
                );
              },

              onInsufficientCredits: context.onInsufficientCredits,

              onGallerySaved: (galleryImageIds: string[], galleryVideoIds: string[], galleryAudioIds?: string[]) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) {
                  const effectiveGallerySessionId = capturedSessionId || sessionIdRef.current;
                  if (effectiveGallerySessionId) {
                    onBackgroundGallerySavedRef.current?.(effectiveGallerySessionId, galleryImageIds, galleryVideoIds, galleryAudioIds);
                  }
                  return;
                }
                console.log(`[CHAT HOOK] onGallerySaved: ${galleryImageIds.length} image IDs, ${galleryVideoIds.length} video IDs, ${galleryAudioIds?.length || 0} audio IDs`);
                setUIMessages((prev) => applyGalleryIdsToMessages(prev, galleryImageIds, galleryVideoIds, galleryAudioIds));
              },

              onContextTrimmed: () => {
                // Silently trimmed
              },

              onModelRefusal: (_refusedContent: string) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                console.log('[CHAT HOOK] Model refusal detected, showing confirmation');
                const targetId = localStreamingId.current;
                setPendingRefusalMsgId(targetId);
                setUIMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === targetId
                      ? { ...msg, modelRefusal: true }
                      : msg,
                  ),
                );
              },
            },
          );

          // Update conversation ref with the complete history
          // Guard with isActiveSession to prevent background job from overwriting new session's context
          if (!thisRequest.aborted && isActiveSession()) {
            conversationRef.current = updatedConversation;
          }
        } catch (err: any) {
          if (!thisRequest.aborted && isActiveSession()) {
            if (err.name === 'AbortError' || err.message === 'CANCELLED') {
              console.log('[CHAT HOOK] Tool execution cancelled by user');
            } else {
              console.error('[CHAT HOOK] Send message error:', err);
              setError(err.message || 'Failed to send message');
            }
          }
        } finally {
          controllersSet.delete(toolAbortController);

          if (isActiveSession()) {
            activeRequestCountRef.current--;
            if (activeRequestCountRef.current <= 0) {
              activeRequestCountRef.current = 0;
              setIsLoading(false);
              setIsSending(false);
            }
          }

          const next = queuedRequestsRef.current.shift();
          if (next) next();
        }
      };

      // Check concurrency limit
      if (activeRequestCountRef.current >= MAX_CONCURRENT_REQUESTS) {
        console.log('[CHAT HOOK] Request queued (active:', activeRequestCountRef.current, ')');
        const capturedSessionId = sessionIdRef.current;
        queuedRequestsRef.current.push(() => {
          // Skip if session changed while this request was queued
          if (sessionIdRef.current !== capturedSessionId) {
            console.log('[CHAT HOOK] Skipping queued request — session changed');
            // Dequeue next if any (don't decrement — runRequest was never called
            // so the counter was never incremented for this request)
            const next = queuedRequestsRef.current.shift();
            if (next) next();
            return;
          }
          runRequest();
        });
      } else {
        runRequest();
      }
    },
    [], // No dependencies needed - all mutable state accessed via refs
  );

  const cancelToolExecution = useCallback(() => {
    // Abort all queued requests
    queuedRequestsRef.current = [];
    // Abort active request
    abortRef.current.aborted = true;
    // Actually abort all active SDK tool executions (e.g. video generation projects)
    toolAbortControllersRef.current.forEach((c) => c.abort());
    toolAbortControllersRef.current.clear();
    // Clear SogniTV progress overlay
    sogniTVController.clearProgress();
    // Clear progress from any in-progress messages
    setUIMessages((prev) =>
      prev.map((msg) =>
        msg.toolProgress ? { ...msg, toolProgress: null, isStreaming: false } : msg,
      ),
    );
    activeRequestCountRef.current = 0;
    setIsLoading(false);
    setIsSending(false);
  }, []);

  /** Accept switching to the abliterated model. Locks session and resends last message. */
  const acceptModelSwitch = useCallback(() => {
    if (!pendingRefusalMsgId) return;

    // Lock session to abliterated model
    sessionModelRef.current = CHAT_MODEL_ABLITERATED;
    console.log('[CHAT HOOK] Switched to abliterated model for session');

    // Clear the refusal flag from the message
    const refusalMsgId = pendingRefusalMsgId;
    setPendingRefusalMsgId(null);

    // Remove the refusal response from conversation history
    // (it's the last assistant message)
    const lastIdx = conversationRef.current.length - 1;
    if (lastIdx >= 0 && conversationRef.current[lastIdx].role === 'assistant') {
      conversationRef.current.splice(lastIdx, 1);
    }

    // Resend the last user message with the new model
    const lastContent = lastUserMessageRef.current;
    const lastContext = lastSendContextRef.current;
    if (lastContent && lastContext) {
      // Remove the refused assistant message from UI
      setUIMessages((prev) => prev.filter((msg) => msg.id !== refusalMsgId));

      // Also remove the last user message from conversation (sendMessage will re-add it)
      const userIdx = conversationRef.current.length - 1;
      if (userIdx >= 0 && conversationRef.current[userIdx].role === 'user') {
        conversationRef.current.splice(userIdx, 1);
      }

      // Resend
      sendMessage(lastContent, lastContext);
    }
  }, [pendingRefusalMsgId, sendMessage]);

  /** Decline switching — keep the refusal visible, clear the confirmation UI */
  const declineModelSwitch = useCallback(() => {
    setPendingRefusalMsgId(null);
    setUIMessages((prev) =>
      prev.map((msg) =>
        msg.modelRefusal ? { ...msg, modelRefusal: false } : msg,
      ),
    );
  }, []);

  const reset = useCallback((options?: { keepBackground?: boolean }) => {
    if (options?.keepBackground) {
      // Don't abort running tool executions — let them complete in background
      abortRef.current = { aborted: false };
      toolAbortControllersRef.current = new Set();
    } else {
      // Hard reset: abort everything (e.g. deleting the active session)
      abortRef.current.aborted = true;
      toolAbortControllersRef.current.forEach((c) => c.abort());
      toolAbortControllersRef.current.clear();
    }
    queuedRequestsRef.current = [];
    activeRequestCountRef.current = 0;
    welcomeContextRef.current = { ...welcomeContextRef.current, hasImage: false };
    setUIMessages([makeWelcomeMessage(welcomeContextRef.current)]);
    setIsLoading(false);
    setIsSending(false);
    setIsAnalyzing(false);
    setError(null);
    setAllResultUrls([]);
    setAnalysisSuggestions([]);
    allResultUrlsRef.current = [];
    audioResultUrlsRef.current = [];
    analysisSuggestionsRef.current = [];
    conversationRef.current = [];
    sessionModelRef.current = undefined;
    setPendingRefusalMsgId(null);
    lastUserMessageRef.current = '';
    lastSendContextRef.current = null;
  }, []);

  /** Update the welcome message with personalized context */
  const updateWelcome = useCallback((ctx: { userName?: string | null; hasPersonas?: boolean; hasImage?: boolean }) => {
    welcomeContextRef.current = {
      hasImage: ctx.hasImage ?? welcomeContextRef.current.hasImage,
      userName: ctx.userName ?? welcomeContextRef.current.userName,
      hasPersonas: ctx.hasPersonas ?? welcomeContextRef.current.hasPersonas,
    };
    setUIMessages((prev) => {
      // Only update if the first message is the welcome message and no real conversation has started
      if (prev.length > 0 && prev[0].id === 'welcome' && prev.length <= 1) {
        return [makeWelcomeMessage(welcomeContextRef.current)];
      }
      return prev;
    });
  }, []);

  /** Get a serializable snapshot of current session state */
  const getSessionState = useCallback(() => {
    const cleaned = cleanForStorage(uiMessages);
    const msgsWithImages = cleaned.filter(m => m.imageResults?.length);
    const msgsWithVideos = cleaned.filter(m => m.videoResults?.length);
    const totalVideoUrls = cleaned.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const msgsWithGalleryVideoIds = cleaned.filter(m => m.galleryVideoIds?.length);
    console.log(`[CHAT HOOK] getSessionState: ${cleaned.length} msgs, ${msgsWithImages.length} with images, ${msgsWithVideos.length} with videos (${totalVideoUrls} urls), ${msgsWithGalleryVideoIds.length} with gallery video IDs, ${allResultUrlsRef.current.length} allResultUrls`);
    return {
      uiMessages: cleaned,
      conversation: conversationRef.current,
      allResultUrls: allResultUrlsRef.current,
      audioResultUrls: audioResultUrlsRef.current,
      analysisSuggestions: analysisSuggestionsRef.current,
      sessionModel: sessionModelRef.current,
    };
  }, [uiMessages]);

  /** Replace all state from a loaded ChatSession */
  const loadFromSession = useCallback((session: ChatSession) => {
    const msgsWithImages = session.uiMessages.filter(m => m.imageResults?.length);
    const msgsWithVideos = session.uiMessages.filter(m => m.videoResults?.length);
    const totalVideoUrls = session.uiMessages.reduce((n, m) => n + (m.videoResults?.length || 0), 0);
    const msgsWithGalleryVideoIds = session.uiMessages.filter(m => m.galleryVideoIds?.length);
    console.log(`[CHAT HOOK] loadFromSession: ${session.uiMessages.length} msgs, ${msgsWithImages.length} with images, ${msgsWithVideos.length} with videos (${totalVideoUrls} urls), ${msgsWithGalleryVideoIds.length} with gallery video IDs, ${session.allResultUrls.length} allResultUrls`);
    if (msgsWithImages.length > 0) {
      msgsWithImages.forEach(m => console.log(`[CHAT HOOK]   image msg "${m.id}": ${m.imageResults!.length} urls`));
    }
    if (msgsWithVideos.length > 0) {
      msgsWithVideos.forEach(m => console.log(`[CHAT HOOK]   video msg "${m.id}": ${m.videoResults!.length} urls, galleryVideoIds=${m.galleryVideoIds?.length || 0}`));
    }
    // DON'T abort running tool executions — let them complete in background.
    // Just reset the abort flag for the NEW session's requests.
    abortRef.current = { aborted: false };
    // Detach background controllers: create a fresh set for the new session so
    // cancelToolExecution only aborts the new session's jobs, not background ones.
    // Background jobs' finally blocks will call delete() on the old set reference
    // they captured at creation time — harmless since we've moved on.
    toolAbortControllersRef.current = new Set();
    // Clear queued requests (they belong to the old session)
    queuedRequestsRef.current = [];
    // Reset active request count for the new session's UI state
    activeRequestCountRef.current = 0;
    setUIMessages(session.uiMessages.map(m => ({ ...m, isFromHistory: true })));
    setAllResultUrls(session.allResultUrls);
    setAnalysisSuggestions(session.analysisSuggestions);
    setIsLoading(false);
    setIsSending(false);
    setIsAnalyzing(false);
    setError(null);
    conversationRef.current = session.conversation;
    allResultUrlsRef.current = session.allResultUrls;
    audioResultUrlsRef.current = session.audioResultUrls || [];
    analysisSuggestionsRef.current = session.analysisSuggestions;
    sessionModelRef.current = session.sessionModel;
  }, []);

  /** Set gallery image/video IDs on the most recent messages that have matching results */
  const setGalleryIds = useCallback((galleryImageIds: string[], galleryVideoIds?: string[]) => {
    setUIMessages((prev) => applyGalleryIdsToMessages(prev, galleryImageIds, galleryVideoIds));
  }, []);

  const setSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
  }, []);

  const getSessionId = useCallback(() => sessionIdRef.current, []);

  const setOnBackgroundComplete = useCallback((cb: typeof onBackgroundCompleteRef.current) => {
    onBackgroundCompleteRef.current = cb;
  }, []);

  const setOnBackgroundGallerySaved = useCallback((cb: typeof onBackgroundGallerySavedRef.current) => {
    onBackgroundGallerySavedRef.current = cb;
  }, []);

  const setOnRecoveryToast = useCallback((cb: typeof onRecoveryToastRef.current) => {
    onRecoveryToastRef.current = cb;
  }, []);

  /**
   * Attach SDK recovery event listeners. Called once when sogniClient is available.
   * Returns cleanup function to remove listeners.
   */
  const attachRecoveryListeners = useCallback((sogniClient: SogniClient) => {
    const handleCompletedRecovery = async (projects: any[]) => {
      await projectSessionMap.ready;
      console.log(`[CHAT HOOK] Recovery: ${projects.length} completed projects recovered`);
      for (const project of projects) {
        const sessionId = projectSessionMap.getSessionId(project.id);
        if (!sessionId) continue;

        const modelType = project.model?.type || 'image';
        const mediaLabel = modelType === 'video' ? 'video'
          : modelType === 'music' ? 'music'
          : 'image';
        const resultUrls: string[] = project.resultUrls || [];
        if (resultUrls.length === 0) continue;

        const isImage = modelType === 'image';
        const isVideo = modelType === 'video';
        const isAudio = modelType === 'music';

        const recoveryMsg: UIChatMessage = {
          id: `recovery-${project.id}-${Date.now()}`,
          role: 'assistant',
          content: `Your ${mediaLabel} finished while you were away.`,
          timestamp: Date.now(),
          ...(isImage ? { imageResults: resultUrls } : {}),
          ...(isVideo ? { videoResults: resultUrls } : {}),
          ...(isAudio ? { audioResults: resultUrls } : {}),
          modelName: project.model?.name,
          isRecoveryMessage: true,
        };

        if (sessionId === sessionIdRef.current) {
          if (isImage) {
            allResultUrlsRef.current = [...allResultUrlsRef.current, ...resultUrls];
            setAllResultUrls((prev) => [...prev, ...resultUrls]);
          }
          if (isAudio) {
            audioResultUrlsRef.current = [...audioResultUrlsRef.current, ...resultUrls];
          }
          setUIMessages((prev) => [...prev, recoveryMsg]);
        } else {
          updateSessionMessages(sessionId, (msgs) => [...msgs, recoveryMsg]);
          onRecoveryToastRef.current?.(
            `A ${mediaLabel} generation completed in another chat`
          );
        }

        projectSessionMap.remove(project.id);
      }
    };

    const handleActiveRecovery = async (projects: any[]) => {
      await projectSessionMap.ready;
      console.log(`[CHAT HOOK] Recovery: ${projects.length} active projects still processing`);
      for (const project of projects) {
        const sessionId = projectSessionMap.getSessionId(project.id);
        if (!sessionId) continue;

        const modelType = project.model?.type || 'image';
        const mediaLabel = modelType === 'video' ? 'video'
          : modelType === 'music' ? 'music'
          : 'image';

        const sdkProject = (sogniClient as any).projects?.trackedProjects?.find(
          (p: any) => p.id === project.id
        );

        const recoveryMsgId = `recovery-active-${project.id}-${Date.now()}`;

        if (sessionId === sessionIdRef.current) {
          const toolName = (modelType === 'video' ? 'generate_video'
            : modelType === 'music' ? 'generate_music'
            : 'generate_image') as ToolName;

          const progressMsg: UIChatMessage = {
            id: recoveryMsgId,
            role: 'assistant',
            content: `Your ${mediaLabel} is still being processed...`,
            timestamp: Date.now(),
            toolProgress: { type: 'started', toolName },
            isRecoveryMessage: true,
          };
          setUIMessages((prev) => [...prev, progressMsg]);

          if (sdkProject) {
            sdkProject.on('completed', (urls: string[]) => {
              const isImage = modelType === 'image';
              const isVideo = modelType === 'video';
              const isAudio = modelType === 'music';
              if (isImage) {
                allResultUrlsRef.current = [...allResultUrlsRef.current, ...urls];
                setAllResultUrls((prev) => [...prev, ...urls]);
              }
              if (isAudio) {
                audioResultUrlsRef.current = [...audioResultUrlsRef.current, ...urls];
              }
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === recoveryMsgId
                    ? {
                        ...msg,
                        content: `Your ${mediaLabel} finished while you were away.`,
                        toolProgress: null,
                        ...(isImage ? { imageResults: urls } : {}),
                        ...(isVideo ? { videoResults: urls } : {}),
                        ...(isAudio ? { audioResults: urls } : {}),
                        modelName: project.model?.name,
                      }
                    : msg,
                ),
              );
              projectSessionMap.remove(project.id);
            });
            sdkProject.on('failed', () => {
              setUIMessages((prev) =>
                prev.map((msg) =>
                  msg.id === recoveryMsgId
                    ? {
                        ...msg,
                        content: `Your ${mediaLabel} generation failed.`,
                        toolProgress: null,
                      }
                    : msg,
                ),
              );
              projectSessionMap.remove(project.id);
            });
          }
        } else {
          onRecoveryToastRef.current?.(
            `A ${mediaLabel} generation is still in progress in another chat`
          );
          if (sdkProject) {
            sdkProject.on('completed', (urls: string[]) => {
              const isImage = modelType === 'image';
              const isVideo = modelType === 'video';
              const isAudio = modelType === 'music';
              const completedMsg: UIChatMessage = {
                id: `recovery-${project.id}-done-${Date.now()}`,
                role: 'assistant',
                content: `Your ${mediaLabel} finished while you were away.`,
                timestamp: Date.now(),
                ...(isImage ? { imageResults: urls } : {}),
                ...(isVideo ? { videoResults: urls } : {}),
                ...(isAudio ? { audioResults: urls } : {}),
                modelName: project.model?.name,
                isRecoveryMessage: true,
              };
              updateSessionMessages(sessionId, (msgs) => [...msgs, completedMsg]);
              onRecoveryToastRef.current?.(
                `A ${mediaLabel} generation completed in another chat`
              );
              projectSessionMap.remove(project.id);
            });
            sdkProject.on('failed', () => {
              projectSessionMap.remove(project.id);
            });
          }
        }
      }
    };

    (sogniClient as any).projects?.on?.('completedProjectsRecovered', handleCompletedRecovery);
    (sogniClient as any).projects?.on?.('activeProjectsRecovered', handleActiveRecovery);

    return () => {
      (sogniClient as any).projects?.off?.('completedProjectsRecovered', handleCompletedRecovery);
      (sogniClient as any).projects?.off?.('activeProjectsRecovered', handleActiveRecovery);
    };
  }, []);

  /**
   * Retry a tool execution directly (bypassing the LLM) with optional model override.
   * Used by the MediaActionsMenu "Try Again" / "Switch Model" actions.
   *
   * Mirrors sendMessage's session safety, concurrency, and abort patterns.
   * Does NOT modify conversationRef — retries bypass the LLM entirely,
   * so adding synthetic entries would confuse the LLM's context on the next real message.
   * Empty deps array is intentional: all mutable state accessed via refs/stable setters.
   */
  const retryToolExecution = useCallback(
    async (
      targetMessage: UIChatMessage,
      context: {
        sogniClient: SogniClient;
        imageData: Uint8Array | null;
        width: number;
        height: number;
        tokenType: TokenType;
        balances: Balances | null;
        qualityTier?: 'fast' | 'hq';
        safeContentFilter?: boolean;
        onContentFilterChange?: (enabled: boolean) => void;
        uploadedFiles?: UploadedFile[];
        onTokenSwitch?: (newType: TokenType) => void;
        onInsufficientCredits?: () => void;
        modelVariantId?: string;
      },
      modelKeyOverride?: string,
    ) => {
      const effectiveToolName = targetMessage.lastCompletedTool as ToolName;
      const toolArgs = targetMessage.toolArgs;
      if (!effectiveToolName || !toolArgs) return;

      // Concurrency guard: block retry if already loading (matches sendMessage pattern)
      if (activeRequestCountRef.current >= MAX_CONCURRENT_REQUESTS) {
        console.log('[CHAT HOOK] Retry blocked — max concurrent requests reached');
        return;
      }

      // Build modified args with model override.
      // When switching models, we must:
      //  1. Set the correct model arg for the new model
      //  2. Remove orphaned model args from previous switches (e.g. "model" leftover from flux2)
      //  3. Remove model-specific numeric params (guidance, steps) so the new model's defaults apply
      const modifiedArgs = { ...toolArgs };
      let isQualityOverride = false;
      if (modelKeyOverride && isQualityTierTool(effectiveToolName)) {
        if (modelKeyOverride === 'fast' || modelKeyOverride === 'hq') {
          isQualityOverride = true;
          modifiedArgs[getModelArgKey(effectiveToolName)] = modelKeyOverride;
          // Remove orphaned "model" arg from a previous non-quality switch (e.g. flux2 → hq)
          delete modifiedArgs.model;
        } else {
          // Non-quality model key (e.g. "flux2") — pass as "model" arg
          modifiedArgs.model = modelKeyOverride;
          // Remove quality arg so handler doesn't see conflicting tier info
          delete modifiedArgs.quality;
        }
      } else if (modelKeyOverride) {
        const argKey = getModelArgKey(effectiveToolName);
        modifiedArgs[argKey] = modelKeyOverride;
        // Strip model-specific numeric params so the new model's defaults apply.
        // Without this, e.g. pony-v7's guidance=7.0 would leak to z-turbo (default 1.0).
        delete modifiedArgs.guidance;
        delete modifiedArgs.steps;
      }

      // Session safety: capture session ID for background detection (mirrors sendMessage)
      const capturedSessionId = sessionIdRef.current;
      const isActiveSession = () =>
        capturedSessionId === null
          ? !toolAbortController.signal.aborted
          : sessionIdRef.current === capturedSessionId;

      activeRequestCountRef.current++;
      setError(null);
      setIsLoading(true);
      setIsSending(true);

      // Add a user message indicating retry
      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const userMsg: UIChatMessage = {
        id: userMsgId,
        role: 'user',
        content: modelKeyOverride ? 'Retry with different model' : 'Retry generation',
        timestamp: Date.now(),
      };

      // Add streaming assistant message for tool progress
      // NOTE: toolArgs is preserved via ...msg spread in onToolComplete for re-retry support
      const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assistantMsg: UIChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        toolArgs: modifiedArgs,
        toolProgress: { type: 'started', toolName: effectiveToolName, totalCount: 0, referencedPersonas: targetMessage.referencedPersonas },
      };

      setUIMessages(prev => [...prev, userMsg, assistantMsg]);

      const variant = context.modelVariantId ? getVariantById(context.modelVariantId) : undefined;
      const effectiveModel = sessionModelRef.current || (variant ? variant.modelId : undefined);
      const effectiveThink = variant?.think;

      const toolAbortController = new AbortController();
      const controllersSet = toolAbortControllersRef.current;
      controllersSet.add(toolAbortController);

      const executionContext: ToolExecutionContext = {
        sogniClient: context.sogniClient,
        imageData: context.imageData,
        width: context.width,
        height: context.height,
        tokenType: context.tokenType,
        uploadedFiles: context.uploadedFiles || [],
        get resultUrls() { return allResultUrlsRef.current; },
        get audioResultUrls() { return audioResultUrlsRef.current; },
        balances: context.balances,
        qualityTier: isQualityOverride ? (modelKeyOverride as 'fast' | 'hq') : context.qualityTier,
        safeContentFilter: context.safeContentFilter,
        onContentFilterChange: context.onContentFilterChange,
        onTokenSwitch: context.onTokenSwitch,
        onInsufficientCredits: context.onInsufficientCredits,
        signal: toolAbortController.signal,
        model: effectiveModel,
        think: effectiveThink,
        sessionId: capturedSessionId || '',
      };

      // If the original generation used personas, re-inject their reference photos
      // from the DB (they don't persist in uploadedFiles across sessions/retries).
      const referencedPersonas = targetMessage.referencedPersonas;
      if (referencedPersonas && referencedPersonas.length > 0) {
        try {
          const { getPersonasByNames } = await import('@/utils/userDataDB');
          const personas = await getPersonasByNames(referencedPersonas);
          // Remove any stale persona files, then inject fresh ones
          executionContext.uploadedFiles = executionContext.uploadedFiles.filter(
            f => !f.filename?.startsWith('persona-'),
          );
          for (const persona of personas) {
            const photoToUse = persona.referencePhotoData || persona.photoData;
            if (photoToUse) {
              executionContext.uploadedFiles.push({
                type: 'image' as const,
                data: photoToUse,
                width: persona.referencePhotoData ? undefined : (persona.photoWidth || undefined),
                height: persona.referencePhotoData ? undefined : (persona.photoHeight || undefined),
                mimeType: persona.photoMimeType || 'image/jpeg',
                filename: `persona-${persona.name.toLowerCase().replace(/\s+/g, '-')}.jpg`,
              });
            }
          }
          console.log(`[CHAT HOOK] Re-injected ${personas.length} persona photos for retry`);
        } catch (err) {
          console.warn('[CHAT HOOK] Failed to re-inject persona photos for retry:', err);
        }
      }

      let retryResultUrls: string[] = [];
      let retryVideoUrls: string[] = [];

      const callbacks: ToolCallbacks = {
        onToolProgress: (progress) => {
          if (toolAbortController.signal.aborted) return;
          // Always accumulate URLs even for background sessions
          if (progress.resultUrls) {
            retryResultUrls = [...new Set([...retryResultUrls, ...progress.resultUrls])];
          }
          if (progress.videoResultUrls) {
            retryVideoUrls = [...new Set([...retryVideoUrls, ...progress.videoResultUrls])];
          }
          // SogniTV progress overlay
          if (progress.type === 'progress' && progress.progress != null) {
            sogniTVController.updateProgress({
              progress: progress.progress,
              etaSeconds: progress.etaSeconds,
              toolName: progress.toolName,
              stepLabel: progress.stepLabel,
            });
          } else if (progress.type === 'started' || progress.type === 'error' || progress.type === 'completed') {
            sogniTVController.clearProgress();
          }
          if (!isActiveSession()) return; // Skip React state update for background sessions
          setUIMessages(prev => prev.map(msg => {
            if (msg.id !== assistantMsgId) return msg;
            const prevProgress = msg.toolProgress;
            // Build per-job progress for multi-job operations (e.g., batch video gen)
            let perJobProgress = progress.type === 'started'
              ? undefined
              : prevProgress?.perJobProgress;
            if (progress.jobIndex !== undefined) {
              const prevJob = perJobProgress?.[progress.jobIndex];
              const resultUrl = progress.videoResultUrls?.[0] || progress.resultUrls?.[0];
              perJobProgress = {
                ...perJobProgress,
                [progress.jobIndex]: {
                  progress: progress.progress ?? prevJob?.progress,
                  etaSeconds: progress.etaSeconds ?? prevJob?.etaSeconds,
                  ...(resultUrl ? { resultUrl } : prevJob?.resultUrl ? { resultUrl: prevJob.resultUrl } : {}),
                  ...(progress.error ? { error: progress.error } : prevJob?.error ? { error: prevJob.error } : {}),
                },
              };
            }
            const merged: ToolExecutionProgress = progress.type === 'started'
              ? { ...progress, perJobProgress, referencedPersonas: progress.referencedPersonas ?? prevProgress?.referencedPersonas }
              : {
                  ...prevProgress,
                  ...progress,
                  progress: progress.progress ?? prevProgress?.progress,
                  etaSeconds: progress.etaSeconds ?? prevProgress?.etaSeconds,
                  estimatedCost: progress.estimatedCost ?? prevProgress?.estimatedCost,
                  sourceImageUrl: progress.sourceImageUrl ?? prevProgress?.sourceImageUrl,
                  videoAspectRatio: progress.videoAspectRatio ?? prevProgress?.videoAspectRatio,
                  modelName: progress.modelName ?? prevProgress?.modelName,
                  referencedPersonas: progress.referencedPersonas ?? prevProgress?.referencedPersonas,
                  resultUrls: progress.resultUrls
                    ? [...new Set([...(prevProgress?.resultUrls || []), ...progress.resultUrls])]
                    : prevProgress?.resultUrls,
                  perJobProgress,
                };
            const videoResults = retryVideoUrls.length > 0 ? [...retryVideoUrls] : msg.videoResults;
            // Clear stale gallery IDs on restart
            const galleryVideoIds = progress.type === 'started' ? undefined : msg.galleryVideoIds;
            return { ...msg, toolProgress: merged, videoResults, galleryVideoIds };
          }));
        },
        onToolComplete: (completedToolName, resultUrls, videoResultUrls) => {
          sogniTVController.notifyToolComplete();
          if (toolAbortController.signal.aborted) return;

          retryResultUrls = [...new Set([...retryResultUrls, ...resultUrls])];
          if (videoResultUrls) {
            retryVideoUrls = [...new Set([...retryVideoUrls, ...videoResultUrls])];
          }

          if (!isActiveSession()) {
            // Background completion — notify parent to persist to IndexedDB
            const effectiveSessionId = capturedSessionId || sessionIdRef.current;
            if (effectiveSessionId) {
              onBackgroundCompleteRef.current?.(effectiveSessionId, {
                toolName: completedToolName,
                resultUrls: [...new Set(retryResultUrls)],
                videoResultUrls: retryVideoUrls.length > 0 ? [...new Set(retryVideoUrls)] : undefined,
                assistantContent: '',
                streamingMsgId: assistantMsgId,
              });
            }
            return;
          }

          const isAudioTool = completedToolName === 'generate_music';
          setUIMessages(prev => prev.map(msg => {
            if (msg.id !== assistantMsgId) return msg;
            const srcUrl = msg.toolProgress?.sourceImageUrl;
            const vidAR = msg.toolProgress?.videoAspectRatio;
            const mdlName = msg.toolProgress?.modelName;
            const retryModelKey = (modifiedArgs.model as string)
              || (modifiedArgs.videoModel as string)
              || (modifiedArgs.quality as string)
              || undefined;
            return {
              ...msg,
              // toolArgs preserved via ...msg spread for re-retry support
              imageResults: !isAudioTool && retryResultUrls.length > 0 ? retryResultUrls : undefined,
              videoResults: retryVideoUrls.length > 0 ? retryVideoUrls : undefined,
              audioResults: isAudioTool && retryResultUrls.length > 0 ? retryResultUrls : undefined,
              toolProgress: null,
              isStreaming: false,
              lastCompletedTool: completedToolName,
              sourceImageUrl: srcUrl || undefined,
              videoAspectRatio: vidAR || undefined,
              modelName: mdlName || undefined,
              toolModelKey: retryModelKey,
              referencedPersonas: msg.toolProgress?.referencedPersonas || msg.referencedPersonas,
              content: '',
            };
          }));

          // Update result URLs
          if (retryResultUrls.length > 0) {
            const combined = [...new Set([...allResultUrlsRef.current, ...retryResultUrls])];
            allResultUrlsRef.current = combined;
            setAllResultUrls(combined);
          }
          if (isAudioTool && retryResultUrls.length > 0) {
            audioResultUrlsRef.current = [...new Set([...audioResultUrlsRef.current, ...retryResultUrls])];
          }
        },
        onGallerySaved: (galleryImageIds, galleryVideoIds, galleryAudioIds) => {
          if (isActiveSession()) {
            setUIMessages(prev => applyGalleryIdsToMessages(prev, galleryImageIds, galleryVideoIds, galleryAudioIds));
          } else {
            // Background: notify parent for IndexedDB persistence
            const effectiveSessionId = capturedSessionId || sessionIdRef.current;
            if (effectiveSessionId) {
              onBackgroundGallerySavedRef.current?.(effectiveSessionId, galleryImageIds, galleryVideoIds, galleryAudioIds);
            }
          }
        },
      };

      try {
        const result = await toolRegistry.execute(effectiveToolName, modifiedArgs, executionContext, callbacks, { skipValidation: !!modelKeyOverride });
        if (toolAbortController.signal.aborted || !isActiveSession()) return;
        // If the tool returned an error JSON and onToolComplete wasn't called, show error.
        // Guard on isStreaming: if onToolComplete already fired, the message is finalized.
        try {
          const parsed = JSON.parse(result);
          if (parsed.error) {
            setUIMessages(prev => prev.map(msg =>
              msg.id === assistantMsgId && msg.isStreaming
                ? { ...msg, content: `Error: ${parsed.error}`, isStreaming: false, toolProgress: null }
                : msg,
            ));
          }
        } catch { /* not JSON, ignore */ }
      } catch (err: any) {
        if (toolAbortController.signal.aborted) return;
        if (isActiveSession()) {
          setError(err.message || 'Retry failed');
          setUIMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: 'Retry failed', isStreaming: false, toolProgress: null }
              : msg,
          ));
        }
      } finally {
        controllersSet.delete(toolAbortController);
        if (isActiveSession()) {
          activeRequestCountRef.current--;
          if (activeRequestCountRef.current <= 0) {
            activeRequestCountRef.current = 0;
            setIsLoading(false);
            setIsSending(false);
          }
        }
        // Dequeue next queued request (matches sendMessage pattern)
        const next = queuedRequestsRef.current.shift();
        if (next) next();
      }
    },
    [], // No dependencies needed - all mutable state accessed via refs/stable setters
  );

  return {
    messages: uiMessages,
    isLoading,
    isSending,
    isAnalyzing,
    error,
    allResultUrls,
    analysisSuggestions,
    sendMessage,
    analyzeImage,
    reset,
    cancelToolExecution,
    retryToolExecution,
    getSessionState,
    loadFromSession,
    acceptModelSwitch,
    declineModelSwitch,
    pendingRefusal: pendingRefusalMsgId !== null,
    updateWelcome,
    setGalleryIds,
    setSessionId,
    getSessionId,
    setOnBackgroundComplete,
    setOnBackgroundGallerySaved,
    clearError: useCallback(() => setError(null), []),
    attachRecoveryListeners,
    setOnRecoveryToast,
  };
}
