/**
 * ChatAudioResults — Audio player component for music generation results.
 *
 * Renders an <audio> element with controls for playing back generated music.
 * Follows the same pattern as ChatVideoResults but for audio content.
 */

import React, { useRef, useState, useCallback } from 'react';
import { downloadImage } from '@/utils/download';
import { buildDownloadFilename } from '@/utils/downloadFilename';

interface ChatAudioResultsProps {
  /** URLs of generated audio files */
  audioUrls: string[];
  /** Optional label shown above the player */
  label?: string;
  /** Descriptive slug for download filenames (e.g. from session title) */
  downloadSlug?: string;
}

const ChatAudioResults: React.FC<ChatAudioResultsProps> = ({ audioUrls, label, downloadSlug }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleSelect = useCallback((index: number) => {
    setActiveIndex(index);
    // Reset and play the newly selected track
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, []);

  const handleDownload = useCallback(() => {
    const url = audioUrls[activeIndex];
    const filename = buildDownloadFilename(downloadSlug, audioUrls.length > 1 ? activeIndex + 1 : undefined, 'audio');
    downloadImage(url, filename).catch((err) =>
      console.error('[CHAT AUDIO] Download failed:', err),
    );
  }, [audioUrls, activeIndex, downloadSlug]);

  if (!audioUrls || audioUrls.length === 0) {
    return null;
  }

  const activeUrl = audioUrls[activeIndex];

  return (
    <div className="chat-audio-results">
      {label && (
        <div className="chat-audio-results__label">{label}</div>
      )}

      <div className="chat-audio-results__player">
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          key={activeUrl}
          className="chat-audio-results__audio"
        >
          <source src={activeUrl} type="audio/mpeg" />
          <source src={activeUrl} type="audio/wav" />
          Your browser does not support the audio element.
        </audio>
        <button
          onClick={handleDownload}
          aria-label="Save audio"
          className="chat-audio-results__download-btn"
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      {audioUrls.length > 1 && (
        <div className="chat-audio-results__tracks">
          {audioUrls.map((url, index) => (
            <button
              key={url}
              className={`chat-audio-results__track-btn ${index === activeIndex ? 'chat-audio-results__track-btn--active' : ''}`}
              onClick={() => handleSelect(index)}
              type="button"
            >
              Track {index + 1}
            </button>
          ))}
        </div>
      )}

      <style>{`
        .chat-audio-results {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border-radius: 12px;
          background: rgba(var(--rgb-primary, 79, 70, 229), 0.05);
          border: 1px solid rgba(var(--rgb-primary, 79, 70, 229), 0.1);
        }

        .chat-audio-results__label {
          font-size: 0.85rem;
          font-weight: 500;
          color: rgba(var(--rgb-primary, 79, 70, 229), 0.7);
        }

        .chat-audio-results__player {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .chat-audio-results__audio {
          flex: 1;
          min-width: 0;
          border-radius: 8px;
        }

        .chat-audio-results__download-btn {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(var(--rgb-primary, 79, 70, 229), 0.2);
          background: rgba(var(--rgb-primary, 79, 70, 229), 0.08);
          color: rgba(var(--rgb-primary, 79, 70, 229), 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .chat-audio-results__download-btn:hover {
          background: rgba(var(--rgb-primary, 79, 70, 229), 0.18);
          border-color: rgba(var(--rgb-primary, 79, 70, 229), 0.4);
          color: rgb(var(--rgb-primary, 79, 70, 229));
        }

        .chat-audio-results__tracks {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .chat-audio-results__track-btn {
          padding: 4px 12px;
          border-radius: 16px;
          border: 1px solid rgba(var(--rgb-primary, 79, 70, 229), 0.2);
          background: transparent;
          color: rgba(var(--rgb-primary, 79, 70, 229), 0.7);
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .chat-audio-results__track-btn:hover {
          background: rgba(var(--rgb-primary, 79, 70, 229), 0.1);
        }

        .chat-audio-results__track-btn--active {
          background: rgba(var(--rgb-primary, 79, 70, 229), 0.15);
          border-color: rgba(var(--rgb-primary, 79, 70, 229), 0.4);
          color: rgb(var(--rgb-primary, 79, 70, 229));
          font-weight: 500;
        }
      `}</style>
    </div>
  );
};

export default ChatAudioResults;
