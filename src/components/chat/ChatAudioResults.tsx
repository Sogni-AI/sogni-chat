/**
 * ChatAudioResults — Audio player component for music generation results.
 *
 * Renders an <audio> element with controls for playing back generated music.
 * Follows the same pattern as ChatVideoResults but for audio content.
 */

import React, { useRef, useState, useCallback } from 'react';

interface ChatAudioResultsProps {
  /** URLs of generated audio files */
  audioUrls: string[];
  /** Optional label shown above the player */
  label?: string;
  /** Called when the active track changes (for menu sync) */
  onActiveIndexChange?: (index: number) => void;
}

const ChatAudioResults: React.FC<ChatAudioResultsProps> = ({ audioUrls, label, onActiveIndexChange }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleSelect = useCallback((index: number) => {
    setActiveIndex(index);
    onActiveIndexChange?.(index);
    // Reset and play the newly selected track
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, [onActiveIndexChange]);

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
