/**
 * Sonic Logos - Sogni Brand Sounds
 * Uses Web Audio API for cross-browser/device compatibility
 */

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (!audioContext) {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioContext = new AudioContextClass();
      }
    } catch {
      return null;
    }
  }
  if (audioContext?.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
};

/**
 * Pre-warms the AudioContext for iOS compatibility.
 * Call this during a user interaction (click/tap) BEFORE the async
 * callback that will play the sonic logo.
 */
export const warmUpAudio = (): void => {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Silently fail
  }
};

// ============================================
// SPARKLE CROWN HD
// For: Video generation complete
// ============================================
export const playVideoComplete = (): void => {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0.28, now);

  // Warm bass bed
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(87, now + 0.05);
  subGain.gain.setValueAtTime(0, now + 0.05);
  subGain.gain.linearRampToValueAtTime(0.5, now + 0.12);
  subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
  sub.connect(subGain);
  subGain.connect(master);
  sub.start(now + 0.05);
  sub.stop(now + 0.65);

  // Whoosh
  const whoosh = ctx.createOscillator();
  const whooshGain = ctx.createGain();
  const whooshFilter = ctx.createBiquadFilter();
  whoosh.type = 'sawtooth';
  whoosh.frequency.setValueAtTime(80, now);
  whoosh.frequency.exponentialRampToValueAtTime(400, now + 0.15);
  whooshFilter.type = 'bandpass';
  whooshFilter.frequency.setValueAtTime(200, now);
  whooshFilter.frequency.exponentialRampToValueAtTime(1000, now + 0.15);
  whooshFilter.Q.setValueAtTime(0.5, now);
  whooshGain.gain.setValueAtTime(0, now);
  whooshGain.gain.linearRampToValueAtTime(0.2, now + 0.08);
  whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  whoosh.connect(whooshFilter);
  whooshFilter.connect(whooshGain);
  whooshGain.connect(master);
  whoosh.start(now);
  whoosh.stop(now + 0.2);

  // Stereo arpeggio
  const notes = [349, 440, 523, 659];
  const pans = [-0.4, -0.12, 0.12, 0.4];

  notes.forEach((freq, i) => {
    const start = now + 0.1 + (i * 0.07);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pans[i], start);
    panner.connect(master);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    osc.connect(gain);
    gain.connect(panner);
    osc.start(start);
    osc.stop(start + 0.5);
  });

  // Sparkles dancing across stereo
  const sparkles = [1319, 1568, 1760, 1568, 2093];
  const sparklePans = [-0.7, 0.5, -0.3, 0.7, 0];

  sparkles.forEach((freq, i) => {
    const start = now + 0.18 + (i * 0.07);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(sparklePans[i], start);
    panner.connect(master);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.2, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    osc.connect(gain);
    gain.connect(panner);
    osc.start(start);
    osc.stop(start + 0.25);
  });
};

export default playVideoComplete;
