/**
 * Pill-shaped suggestion chip buttons shown after assistant messages.
 * Each chip is a single-click action — restoration modes are individual chips.
 */
import type { Suggestion } from '@/utils/chatSuggestions';
import './chat.css';

interface SuggestionChipsProps {
  suggestions: Suggestion[];
  onSelect: (text: string) => void;
  analysisSuggestions?: Suggestion[];
}

function ChipButton({ suggestion, onSelect }: { suggestion: Suggestion; onSelect: (text: string) => void }) {
  return (
    <button
      onClick={() => onSelect(suggestion.prompt)}
      title={suggestion.prompt}
      style={{
        padding: '0.375rem 0.875rem',
        fontSize: '0.8125rem',
        fontWeight: 500,
        fontFamily: 'var(--font-body, Inter, sans-serif)',
        color: 'var(--color-text-secondary)',
        background: 'rgba(var(--rgb-primary), 0.04)',
        border: '1px solid var(--color-border)',
        borderRadius: '999px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(var(--rgb-accent), 0.1)';
        e.currentTarget.style.borderColor = 'var(--color-accent)';
        e.currentTarget.style.color = 'var(--color-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(var(--rgb-primary), 0.04)';
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }}
    >
      {suggestion.label}
    </button>
  );
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        padding: '0.25rem 0',
        animation: 'chipsFadeIn 0.3s ease-out',
      }}
    >
      {suggestions.map((suggestion) => (
        <ChipButton key={suggestion.label} suggestion={suggestion} onSelect={onSelect} />
      ))}
    </div>
  );
}
