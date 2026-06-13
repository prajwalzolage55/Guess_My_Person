/* audio.ts — Web Audio API sound effects.
   Owns: all game sounds using oscillator synthesis.
   Does NOT own: game logic, UI. No audio files needed. */

let audioCtx: AudioContext | null = null;
let contextResumed = false;

function getSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem("soundEnabled");
    if (stored === null) return true;
    return stored === "true";
  } catch (e) {
    return true;
  }
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  } catch (e) {
    console.warn("Web Audio API is not supported in this browser.", e);
  }
  return audioCtx;
}

function resumeContext() {
  if (contextResumed) return;
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().then(() => {
      contextResumed = true;
    });
  } else if (ctx) {
    contextResumed = true;
  }
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.3,
  startOffset = 0
) {
  const ctx = getContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  gainNode.gain.setValueAtTime(volume, ctx.currentTime + startOffset);

  // Quick fade-out at the end to avoid clicks
  const endTime = ctx.currentTime + startOffset + duration / 1000;
  gainNode.gain.setValueAtTime(volume, endTime - 0.01);
  gainNode.gain.linearRampToValueAtTime(0, endTime);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime + startOffset);
  oscillator.stop(endTime);
}

export const SFX = {
  init: () => {
    if (typeof window === "undefined") return;
    const resumeHandler = () => {
      resumeContext();
      document.removeEventListener("click", resumeHandler);
      document.removeEventListener("touchstart", resumeHandler);
    };
    document.addEventListener("click", resumeHandler);
    document.addEventListener("touchstart", resumeHandler);
  },

  playCorrect: () => {
    if (!getSoundEnabled()) return;
    resumeContext();
    playTone(523, 100, "sine", 0.3, 0); // C5
    playTone(659, 100, "sine", 0.3, 0.1); // E5
    playTone(784, 200, "sine", 0.3, 0.2); // G5
  },

  playWrong: () => {
    if (!getSoundEnabled()) return;
    resumeContext();
    playTone(330, 150, "sawtooth", 0.3, 0); // E4
    playTone(262, 200, "sawtooth", 0.3, 0.15); // C4
  },

  playTick: () => {
    if (!getSoundEnabled()) return;
    resumeContext();
    playTone(800, 50, "sine", 0.15, 0);
  },

  playPop: () => {
    if (!getSoundEnabled()) return;
    resumeContext();
    playTone(600, 80, "sine", 0.25, 0);
  },

  toggleSound: (): boolean => {
    if (typeof window === "undefined") return true;
    const current = getSoundEnabled();
    const newState = !current;
    try {
      window.localStorage.setItem("soundEnabled", String(newState));
    } catch (e) {}
    return newState;
  },

  isSoundOn: (): boolean => {
    return getSoundEnabled();
  },
};
