/**
 * React hook for recording short voice clips via MediaRecorder API.
 * Used by the Persona voice clip feature for LTX-2.3 referenceAudioIdentity.
 *
 * Auto-stops at maxDuration seconds. Returns audio as Uint8Array + MIME type.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const DEFAULT_MAX_DURATION = 5;

/** Preferred MIME types in order of preference */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function getSupportedMimeType(): string | null {
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return null;
}

export interface UseVoiceRecorderReturn {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  audioData: Uint8Array | null;
  audioMimeType: string | null;
  clearRecording: () => void;
  error: string | null;
}

export function useVoiceRecorder(maxDuration = DEFAULT_MAX_DURATION): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioData, setAudioData] = useState<Uint8Array | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setError('Your browser does not support audio recording.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        setAudioData(new Uint8Array(arrayBuffer));
        setAudioMimeType(mimeType);
        setIsRecording(false);
        console.log(`[VOICE] Recording complete: ${(arrayBuffer.byteLength / 1024).toFixed(1)}KB, ${mimeType}`);

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      recorder.onerror = () => {
        setError('Recording failed. Please try again.');
        setIsRecording(false);
        cleanup();
      };

      recorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setDuration(0);

      // Update duration counter every 100ms
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setDuration(Math.min(elapsed, maxDuration));
      }, 100);

      // Auto-stop at max duration
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log(`[VOICE] Auto-stopping at ${maxDuration}s`);
          mediaRecorderRef.current.stop();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, maxDuration * 1000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Microphone access denied. Please allow microphone access and try again.');
      } else {
        setError(`Could not access microphone: ${message}`);
      }
      console.error('[VOICE] Failed to start recording:', err);
      cleanup();
    }
  }, [maxDuration, cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const clearRecording = useCallback(() => {
    setAudioData(null);
    setAudioMimeType(null);
    setDuration(0);
    setError(null);
    chunksRef.current = [];
  }, []);

  return {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    audioData,
    audioMimeType,
    clearRecording,
    error,
  };
}
