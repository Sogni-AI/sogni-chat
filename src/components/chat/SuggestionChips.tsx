/**
 * Suggestion chip buttons — ChatGPT-inspired subtle bordered style.
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
        padding: '0.5rem 1rem',
        fontSize: '0.8125rem',
        fontWeight: 400,
        fontFamily: 'var(--font-primary)',
        color: '#b4b4b4',
        background: 'transparent',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-pill)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        e.currentTarget.style.color = '#ececec';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.color = '#b4b4b4';
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
