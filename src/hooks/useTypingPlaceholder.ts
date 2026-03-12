import { useState, useEffect, useRef, useMemo } from 'react';

const DEFAULT_PHRASES = [
  'Restore an old family photo',
  'Apply an artistic style to a photo',
  'Generate an image from a description',
  'Edit details in a photo',
  'Animate a photo into a video',
  'Change the camera angle of a photo',
  'Create a video from a text prompt',
  "Transform a video's style",
  'Generate a music video from audio',
  'Compose an original song',
  'Refine a previous result',
];

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface UseTypingPlaceholderOptions {
  phrases?: string[];
  enabled?: boolean;
  typingSpeed?: number;
  deleteSpeed?: number;
  pauseDuration?: number;
}

export function useTypingPlaceholder({
  phrases = DEFAULT_PHRASES,
  enabled = true,
  typingSpeed = 60,
  deleteSpeed = 30,
  pauseDuration = 2000,
}: UseTypingPlaceholderOptions = {}): string {
  const [text, setText] = useState('');
  const shuffledPhrases = useMemo(() => shuffle(phrases), [phrases]);
  const stateRef = useRef({
    phraseIndex: 0,
    charIndex: 0,
    phase: 'typing' as 'typing' | 'pausing' | 'deleting' | 'gap',
  });

  useEffect(() => {
    if (!enabled) {
      setText('');
      stateRef.current = { phraseIndex: 0, charIndex: 0, phase: 'typing' };
      return;
    }

    // Respect prefers-reduced-motion
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = motionQuery.matches;

    if (prefersReducedMotion) {
      let index = 0;
      setText(shuffledPhrases[0]);
      const interval = setInterval(() => {
        index = (index + 1) % shuffledPhrases.length;
        setText(shuffledPhrases[index]);
      }, 4000);
      return () => clearInterval(interval);
    }

    const state = stateRef.current;
    state.phraseIndex = 0;
    state.charIndex = 0;
    state.phase = 'typing';
    setText('');

    const tick = () => {
      const phrase = shuffledPhrases[state.phraseIndex];

      switch (state.phase) {
        case 'typing':
          state.charIndex++;
          setText(phrase.slice(0, state.charIndex));
          if (state.charIndex >= phrase.length) {
            state.phase = 'pausing';
          }
          break;
        case 'pausing':
          state.phase = 'deleting';
          break;
        case 'deleting':
          state.charIndex--;
          setText(phrase.slice(0, state.charIndex));
          if (state.charIndex <= 0) {
            state.phase = 'gap';
          }
          break;
        case 'gap':
          state.phraseIndex = (state.phraseIndex + 1) % shuffledPhrases.length;
          state.charIndex = 0;
          state.phase = 'typing';
          break;
      }
    };

    let timerId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      let delay: number;
      switch (state.phase) {
        case 'typing':
          delay = typingSpeed;
          break;
        case 'pausing':
          delay = pauseDuration;
          break;
        case 'deleting':
          delay = deleteSpeed;
          break;
        case 'gap':
          delay = 300;
          break;
      }
      timerId = setTimeout(() => {
        tick();
        schedule();
      }, delay);
    };

    schedule();

    return () => clearTimeout(timerId);
  }, [enabled, shuffledPhrases, typingSpeed, deleteSpeed, pauseDuration]);

  return text;
}
