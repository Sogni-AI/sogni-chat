/**
 * Chat input component with auto-resizing textarea, file attachment, and send button.
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { UploadedFile } from '@/tools/types';
import { ACCEPT_ALL_MEDIA } from '@/services/fileUpload';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Currently attached media files */
  uploadedFiles?: UploadedFile[];
  /** True while a file is being processed */
  isMediaUploading?: boolean;
  /** Add a media file */
  onAddMediaFile?: (file: File) => Promise<void>;
  /** Remove a media file by index */
  onRemoveMediaFile?: (index: number) => void;
}

/** Human-readable label for an uploaded file */
function fileLabel(f: UploadedFile): string {
  const name = f.filename.length > 24
    ? f.filename.slice(0, 20) + '...' + f.filename.slice(f.filename.lastIndexOf('.'))
    : f.filename;
  return name;
}

/** Icon per media type */
function FileTypeIcon({ type }: { type: UploadedFile['type'] }) {
  if (type === 'audio') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (type === 'video') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }
  // image
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export const ChatInput = memo(function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Describe what you want done with your photo...',
  uploadedFiles,
  isMediaUploading,
  onAddMediaFile,
  onRemoveMediaFile,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleAttachClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onAddMediaFile) return;
      await onAddMediaFile(file);
    },
    [onAddMediaFile],
  );

  const hasFiles = uploadedFiles && uploadedFiles.length > 0;

  return (
    <div
      className="chat-input-wrap"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '0.75rem 1rem',
        background: 'var(--color-bg-elevated)',
        borderTop: '1px solid var(--color-border)',
        borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
        gap: '0.5rem',
      }}
    >
      {/* Attached files preview */}
      {hasFiles && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.375rem',
          }}
        >
          {uploadedFiles.map((f, i) => (
            <div
              key={`${f.filename}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.25rem 0.5rem',
                background: 'rgba(var(--rgb-primary), 0.06)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
                maxWidth: '200px',
              }}
            >
              <FileTypeIcon type={f.type} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fileLabel(f)}
              </span>
              {onRemoveMediaFile && (
                <button
                  onClick={() => onRemoveMediaFile(i)}
                  aria-label={`Remove ${f.filename}`}
                  style={{
                    flexShrink: 0,
                    width: '1rem',
                    height: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-tertiary)',
                    padding: 0,
                    borderRadius: '50%',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#dc2626';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--color-text-tertiary)';
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {isMediaUploading && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.25rem 0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Processing...
            </div>
          )}
        </div>
      )}

      {/* Input row: attach button + textarea + send button */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ALL_MEDIA}
          onChange={handleFileChange}
          className="hidden"
          style={{ display: 'none' }}
        />

        {/* Attach button */}
        {onAddMediaFile && (
          <button
            onClick={handleAttachClick}
            disabled={disabled || isMediaUploading}
            aria-label="Attach a file"
            title="Attach audio, video, or image file"
            style={{
              flexShrink: 0,
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-secondary)',
              cursor: disabled || isMediaUploading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              opacity: disabled || isMediaUploading ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!disabled && !isMediaUploading) {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.color = 'var(--color-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Chat message"
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.625rem 0.875rem',
            fontSize: '0.875rem',
            lineHeight: '1.5',
            fontFamily: 'var(--font-primary)',
            color: 'var(--color-text-primary)',
            background: 'var(--color-bg)',
            outline: 'none',
            transition: 'border-color 0.2s',
            maxHeight: '160px',
            overflow: 'auto',
            opacity: disabled ? 0.6 : 1,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        />

        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          style={{
            flexShrink: 0,
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: '50%',
            border: 'none',
            background:
              disabled || !value.trim()
                ? 'rgba(var(--rgb-primary), 0.1)'
                : 'var(--sogni-gradient)',
            color: disabled || !value.trim() ? 'var(--color-text-secondary)' : '#fff',
            cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            opacity: disabled || !value.trim() ? 0.5 : 1,
          }}
          title="Send message"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
});
