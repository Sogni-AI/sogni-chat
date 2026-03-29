/**
 * Compact voice clip recorder/uploader for the Persona editor.
 * Allows recording a ~5s voice clip or uploading an audio file.
 * The clip is stored as Uint8Array + MIME type on the Persona for
 * automatic injection as referenceAudioIdentity on LTX-2.3 video generation.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

const MAX_DURATION = 5;

interface VoiceClipManagerProps {
  voiceClipData: Uint8Array | null;
  voiceClipMimeType: string | null;
  voiceClipDuration: number | null;
  onVoiceClipChange: (data: Uint8Array | null, mimeType: string | null, duration: number | null) => void;
}

export function VoiceClipManager({
  voiceClipData,
  voiceClipMimeType,
  voiceClipDuration,
  onVoiceClipChange,
}: VoiceClipManagerProps) {
  const {
    isRecording,
    duration: recordingDuration,
    startRecording,
    stopRecording,
    audioData: recordedData,
    audioMimeType: recordedMimeType,
    clearRecording,
    error: recorderError,
  } = useVoiceRecorder(MAX_DURATION);

  const [isPlaying, setIsPlaying] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When a new recording is captured, propagate to parent
  useEffect(() => {
    if (recordedData && recordedMimeType) {
      // Compute actual duration from the recorded data
      const duration = recordingDuration || MAX_DURATION;
      onVoiceClipChange(recordedData, recordedMimeType, Math.round(duration * 10) / 10);
      clearRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordedData, recordedMimeType]);

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  const handlePlay = useCallback(() => {
    if (!voiceClipData || !voiceClipMimeType) return;

    // Revoke previous URL if any
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
    }

    const blob = new Blob([voiceClipData as BlobPart], { type: voiceClipMimeType });
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      setIsPlaying(false);
    };
    audio.onerror = () => {
      setIsPlaying(false);
    };

    audio.play();
    setIsPlaying(true);
  }, [voiceClipData, voiceClipMimeType]);

  const handleStopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const handleRemove = useCallback(() => {
    handleStopPlayback();
    onVoiceClipChange(null, null, null);
  }, [handleStopPlayback, onVoiceClipChange]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      setUploadError('Please select an audio file.');
      e.target.value = '';
      return;
    }

    // Check duration
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);

      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          if (audio.duration > MAX_DURATION + 0.5) {
            reject(new Error(`Audio is ${audio.duration.toFixed(1)}s — max ${MAX_DURATION}s.`));
          } else {
            resolve();
          }
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Could not read audio file.'));
        };
      });

      // Read as Uint8Array
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const duration = Math.min(audio.duration, MAX_DURATION);

      onVoiceClipChange(data, file.type, Math.round(duration * 10) / 10);
      console.log(`[VOICE] Uploaded voice clip: ${(data.length / 1024).toFixed(1)}KB, ${file.type}, ${duration.toFixed(1)}s`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      setUploadError(message);
    }

    e.target.value = '';
  }, [onVoiceClipChange]);

  const hasClip = !!(voiceClipData && voiceClipData.length > 0);
  const error = recorderError || uploadError;

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Status + controls */}
      {hasClip ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 'var(--radius-md)',
        }}>
          {/* Waveform icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8e8e8e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M8 6v12M4 9v6M16 6v12M20 9v6" />
          </svg>

          <span style={{ fontSize: '0.75rem', color: '#b4b4b4', flex: 1 }}>
            Voice clip ({voiceClipDuration ? `${voiceClipDuration}s` : 'saved'})
          </span>

          {/* Play / Stop button */}
          <button
            onClick={isPlaying ? handleStopPlayback : handlePlay}
            style={{
              width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '50%',
              cursor: 'pointer', color: '#b4b4b4', padding: 0,
            }}
            title={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>

          {/* Remove button */}
          <button
            onClick={handleRemove}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#666',
              padding: '2px', lineHeight: 1, fontSize: '0.75rem',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
            title="Remove voice clip"
          >
            &times;
          </button>
        </div>
      ) : isRecording ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-md)',
        }}>
          {/* Recording indicator */}
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444',
            animation: 'pulse-premium 1s ease-in-out infinite',
            flexShrink: 0,
          }} />

          <span style={{ fontSize: '0.75rem', color: '#ef4444', flex: 1 }}>
            Recording... {recordingDuration.toFixed(1)}s / {MAX_DURATION}s
          </span>

          {/* Stop button */}
          <button
            onClick={stopRecording}
            style={{
              padding: '3px 10px', fontSize: '0.6875rem', fontWeight: 500,
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: '100px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={startRecording}
            style={{
              padding: '5px 12px', fontSize: '0.6875rem', fontWeight: 500,
              background: 'rgba(255,255,255,0.06)', color: '#b4b4b4',
              border: 'none', borderRadius: '100px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              transition: 'all 0.15s',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            Record
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '5px 12px', fontSize: '0.6875rem', fontWeight: 500,
              background: 'rgba(255,255,255,0.06)', color: '#b4b4b4',
              border: 'none', borderRadius: '100px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              transition: 'all 0.15s',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          marginTop: '4px', fontSize: '0.625rem', color: '#ef4444',
          lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}

      {/* Helper text (only when no clip) */}
      {!hasClip && !isRecording && !error && (
        <div style={{
          marginTop: '4px', fontSize: '0.625rem', color: '#555',
          lineHeight: 1.4,
        }}>
          Record or upload a ~5s voice sample. Used for AI video voice cloning.
        </div>
      )}
    </div>
  );
}
