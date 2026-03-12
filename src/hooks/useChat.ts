/**
 * React hook for managing chat-based restoration assistant state.
 * Session persistence is handled externally by useChatSessions (IndexedDB).
 */
import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { SogniClient } from '@sogni-ai/sogni-client';
import { sendChatMessage, sendVisionAnalysis } from '@/services/chatService';
import type { ToolExecutionContext, ToolExecutionProgress, ToolName, UploadedFile } from '@/tools/types';
import type { TokenType, Balances } from '@/types/wallet';
import type { Suggestion } from '@/utils/chatSuggestions';
import { parseAnalysisSuggestions, stripSuggestTagsForDisplay } from '@/utils/chatSuggestions';
import { resizeImageForVision } from '@/utils/imageProcessing';
import type { ChatSession, UIChatMessage } from '@/types/chat';
import { CHAT_MODEL_ABLITERATED } from '@/config/chat';
import { sogniTVController } from '@/services/sogniTVController';
import { getVariantById } from '@/config/modelVariants';

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
      uploadedFiles?: UploadedFile[];
      onTokenSwitch?: (newType: TokenType) => void;
      onInsufficientCredits?: () => void;
      modelVariantId?: string;
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
  ) => void) | null) => void;
  /** Dismiss the current error */
  clearError: () => void;
}

const MAX_CONCURRENT_REQUESTS = 2;

const WELCOME_MESSAGE: UIChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "I can see your photo! I can restore it, apply artistic styles, animate it into a video, change the camera angle, edit details, and more — just describe what you want in your own words.",
  timestamp: Date.now(),
};

/** Strip transient fields before persisting */
function cleanForStorage(messages: UIChatMessage[]): UIChatMessage[] {
  return messages.map((msg) => ({
    ...msg,
    toolProgress: undefined,
    isStreaming: undefined,
    uploadedImageUrl: undefined,
  }));
}

/**
 * Apply gallery image/video IDs to the most recent matching messages.
 * Shared by onGallerySaved (video saves) and setGalleryIds (image saves).
 */
export function applyGalleryIdsToMessages(
  messages: UIChatMessage[],
  galleryImageIds: string[],
  galleryVideoIds?: string[],
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
  return updated;
}

export function useChat(): UseChatResult {
  const [uiMessages, setUIMessages] = useState<UIChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allResultUrls, setAllResultUrls] = useState<string[]>([]);
  const [analysisSuggestions, setAnalysisSuggestions] = useState<Suggestion[]>([]);

  // LLM conversation history (raw ChatMessages for API)
  const conversationRef = useRef<ChatMessage[]>([]);
  // Track all result URLs via ref so tool executions always see the latest state (Fix #4)
  const allResultUrlsRef = useRef<string[]>([]);
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
  ) => void) | null>(null);

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
              // Restore welcome message on failure
              setUIMessages([{ ...WELCOME_MESSAGE, timestamp: Date.now() }]);
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
          setUIMessages([{ ...WELCOME_MESSAGE, timestamp: Date.now() }]);
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
        uploadedFiles?: UploadedFile[];
        onTokenSwitch?: (newType: TokenType) => void;
        onInsufficientCredits?: () => void;
        modelVariantId?: string;
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
          },
        ]);

        // Create AbortController for this request's tool executions.
        // Capture the set reference so background jobs clean up correctly
        // even after loadFromSession replaces the set.
        const toolAbortController = new AbortController();
        const controllersSet = toolAbortControllersRef.current;
        controllersSet.add(toolAbortController);

        // Determine model from variant (user dropdown) or session override (abliterated fallback)
        const variant = context.modelVariantId ? getVariantById(context.modelVariantId) : undefined;
        const effectiveModel = sessionModelRef.current
          || (variant ? variant.modelId : undefined);
        const effectiveThink = variant?.think;

        const executionContext: ToolExecutionContext = {
          sogniClient: context.sogniClient,
          imageData: context.imageData,
          width: context.width,
          height: context.height,
          tokenType: context.tokenType,
          uploadedFiles: context.uploadedFiles || [],
          get resultUrls() { return allResultUrlsRef.current; },
          balances: context.balances,
          qualityTier: context.qualityTier,
          onTokenSwitch: context.onTokenSwitch,
          onInsufficientCredits: context.onInsufficientCredits,
          signal: toolAbortController.signal,
          model: effectiveModel,
          think: effectiveThink,
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
                      ? { ...msg, content: currentContent }
                      : msg,
                  ),
                );
              },

              onToolCall: (toolName: ToolName, _args: Record<string, unknown>) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                console.log('[CHAT HOOK] Tool called:', toolName);
                const targetId = localStreamingId.current;
                setUIMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === targetId
                      ? {
                          ...msg,
                          toolProgress: {
                            type: 'started',
                            toolName,
                            totalCount: 0,
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
                    return { ...msg, toolProgress: { ...progress, perJobProgress }, videoResults, galleryVideoIds };
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
                    // Capture sourceImageUrl and videoAspectRatio from toolProgress before clearing it
                    const srcUrl = msg.toolProgress?.sourceImageUrl;
                    const vidAR = msg.toolProgress?.videoAspectRatio;
                    return {
                      ...msg,
                      imageResults: !isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
                      videoResults: uniqueVideoUrls.length > 0 ? uniqueVideoUrls : undefined,
                      audioResults: isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
                      toolProgress: null,
                      sourceImageUrl: srcUrl || undefined,
                      videoAspectRatio: vidAR || undefined,
                    };
                  }),
                );

                // Update both ref and state for result URLs (Fix #4)
                if (uniqueUrls.length > 0) {
                  const combined = [...new Set([...allResultUrlsRef.current, ...uniqueUrls])];
                  allResultUrlsRef.current = combined;
                  setAllResultUrls(combined);
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
                  },
                ]);
              },

              onComplete: (_fullContent: string) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) return;
                // Mark the current streaming message as done
                const currentMsgId = localStreamingId.current;
                setUIMessages((prev) => {
                  const updated = prev.map((msg) =>
                    msg.id === currentMsgId
                      ? { ...msg, isStreaming: false }
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
                        ? { ...msg, isStreaming: false }
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

              onGallerySaved: (galleryImageIds: string[], galleryVideoIds: string[]) => {
                if (thisRequest.aborted) return;
                if (!isActiveSession()) {
                  const effectiveGallerySessionId = capturedSessionId || sessionIdRef.current;
                  if (effectiveGallerySessionId) {
                    onBackgroundGallerySavedRef.current?.(effectiveGallerySessionId, galleryImageIds, galleryVideoIds);
                  }
                  return;
                }
                console.log(`[CHAT HOOK] onGallerySaved: ${galleryImageIds.length} image IDs, ${galleryVideoIds.length} video IDs`);
                setUIMessages((prev) => applyGalleryIdsToMessages(prev, galleryImageIds, galleryVideoIds));
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
        queuedRequestsRef.current.push(runRequest);
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
    setUIMessages([{ ...WELCOME_MESSAGE, timestamp: Date.now() }]);
    setIsLoading(false);
    setIsSending(false);
    setIsAnalyzing(false);
    setError(null);
    setAllResultUrls([]);
    setAnalysisSuggestions([]);
    allResultUrlsRef.current = [];
    analysisSuggestionsRef.current = [];
    conversationRef.current = [];
    sessionModelRef.current = undefined;
    setPendingRefusalMsgId(null);
    lastUserMessageRef.current = '';
    lastSendContextRef.current = null;
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
    setUIMessages(session.uiMessages);
    setAllResultUrls(session.allResultUrls);
    setAnalysisSuggestions(session.analysisSuggestions);
    setIsLoading(false);
    setIsSending(false);
    setIsAnalyzing(false);
    setError(null);
    conversationRef.current = session.conversation;
    allResultUrlsRef.current = session.allResultUrls;
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
    getSessionState,
    loadFromSession,
    acceptModelSwitch,
    declineModelSwitch,
    pendingRefusal: pendingRefusalMsgId !== null,
    setGalleryIds,
    setSessionId,
    getSessionId,
    setOnBackgroundComplete,
    setOnBackgroundGallerySaved,
    clearError: useCallback(() => setError(null), []),
  };
}
