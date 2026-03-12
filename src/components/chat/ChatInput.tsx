/**
 * Chat input component — ChatGPT-inspired rounded pill style.
 * Auto-resizing textarea with file attachment and send button inside the pill.
 * Images show as aspect-ratio-correct thumbnails; audio/video as text chips.
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
  /** Get a blob URL preview for an image at the given index */
  getPreviewUrl?: (index: number) => string | null;
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
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

/** Image thumbnail with aspect-ratio-correct sizing and X remove button */
function ImageThumbnail({
  previewUrl,
  filename,
  onRemove,
}: {
  previewUrl: string;
  filename: string;
  onRemove?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        height: '48px',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={previewUrl}
        alt={filename}
        style={{
          height: '48px',
          width: 'auto',
          display: 'block',
          objectFit: 'cover',
          borderRadius: 'var(--radius-md)',
        }}
      />
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(0, 0, 0, 0.65)',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: hovered ? 1 : 0.6,
            transition: 'opacity 0.15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Text chip for non-image files (audio, video) */
function FileChip({
  file,
  onRemove,
}: {
  file: UploadedFile;
  onRemove?: () => void;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.5rem',
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-lg)',
        fontSize: '0.75rem',
        color: '#b4b4b4',
        maxWidth: '200px',
        height: '48px',
        boxSizing: 'border-box',
      }}
    >
      <FileTypeIcon type={file.type} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fileLabel(file)}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${file.filename}`}
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
            color: '#8e8e8e',
            padding: 0,
            borderRadius: '50%',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const ChatInput = memo(function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Describe what you want to create...',
  uploadedFiles,
  isMediaUploading,
  onAddMediaFile,
  onRemoveMediaFile,
  getPreviewUrl,
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
  const canSendNow = !disabled && value.trim().length > 0;

  return (
    <div
      className="chat-input-wrap"
      style={{
        padding: '0.75rem 1rem 1rem',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: '48rem', width: '100%' }}>
        {/* Attached files preview */}
        {hasFiles && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '0.5rem',
              alignItems: 'flex-end',
            }}
          >
            {uploadedFiles.map((f, i) => {
              const previewUrl = getPreviewUrl?.(i);
              if (previewUrl) {
                return (
                  <ImageThumbnail
                    key={`${f.filename}-${i}`}
                    previewUrl={previewUrl}
                    filename={f.filename}
                    onRemove={onRemoveMediaFile ? () => onRemoveMediaFile(i) : undefined}
                  />
                );
              }
              return (
                <FileChip
                  key={`${f.filename}-${i}`}
                  file={f}
                  onRemove={onRemoveMediaFile ? () => onRemoveMediaFile(i) : undefined}
                />
              );
            })}
            {isMediaUploading && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#8e8e8e', height: '48px' }}>
                Processing...
              </div>
            )}
          </div>
        )}

        {/* Rounded pill input container */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '0',
            background: '#2f2f2f',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0.5rem 0.75rem',
            transition: 'border-color 0.2s',
          }}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ALL_MEDIA}
            onChange={handleFileChange}
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
                width: '2rem',
                height: '2rem',
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                color: '#8e8e8e',
                cursor: disabled || isMediaUploading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s',
                opacity: disabled || isMediaUploading ? 0.4 : 1,
              }}
              onMouseEnter={(e) => {
                if (!disabled && !isMediaUploading) e.currentTarget.style.color = '#ececec';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#8e8e8e';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
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
              border: 'none',
              borderRadius: 0,
              padding: '0.375rem 0.5rem',
              fontSize: '0.9375rem',
              lineHeight: '1.5',
              fontFamily: 'var(--font-primary)',
              color: '#ececec',
              background: 'transparent',
              outline: 'none',
              maxHeight: '160px',
              overflow: 'auto',
              opacity: disabled ? 0.5 : 1,
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSendNow}
            style={{
              flexShrink: 0,
              width: '2rem',
              height: '2rem',
              borderRadius: '50%',
              border: 'none',
              background: canSendNow ? '#ffffff' : 'rgba(255, 255, 255, 0.1)',
              color: canSendNow ? '#0a0a0a' : '#666666',
              cursor: canSendNow ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            title="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
