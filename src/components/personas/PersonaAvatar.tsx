/**
 * Reusable circular avatar for personas.
 * Sizes: sm=28px, md=44px, lg=80px
 */

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<AvatarSize, number> = {
  sm: 28,
  md: 44,
  lg: 80,
};

interface PersonaAvatarProps {
  personaId: string;
  name: string;
  size?: AvatarSize;
  getThumbnailUrl: (personaId: string) => Promise<string | null>;
  updatedAt?: number;
  onClick?: () => void;
  style?: CSSProperties;
}

export function PersonaAvatar({
  personaId,
  name,
  size = 'md',
  getThumbnailUrl,
  updatedAt,
  onClick,
  style,
}: PersonaAvatarProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const px = SIZE_MAP[size];

  useEffect(() => {
    setThumbUrl(null);
    let cancelled = false;
    getThumbnailUrl(personaId).then(url => {
      if (!cancelled) setThumbUrl(url);
    });
    return () => { cancelled = true; };
  }, [personaId, getThumbnailUrl, updatedAt]);

  const initials = (name || '?').split(' ').filter(w => w.length > 0).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const baseStyle: CSSProperties = {
    width: `${px}px`,
    height: `${px}px`,
    borderRadius: '50%',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2f2f2f',
    border: '2px solid rgba(255,255,255,0.1)',
    transition: 'box-shadow 0.15s, border-color 0.15s',
    fontSize: `${Math.round(px * 0.35)}px`,
    fontWeight: 600,
    color: '#8e8e8e',
    ...style,
  };

  return (
    <div
      style={baseStyle}
      onClick={onClick}
      title={name}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.2)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
      }}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.08)' }}
        />
      ) : (
        initials
      )}
    </div>
  );
}
