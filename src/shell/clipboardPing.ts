// Short synthesized "pling" for clipboard notifications.
// Generated with WebAudio so no sound asset has to ship with the app.

type AudioContextWindow = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

let context: AudioContext | null = null;

export function playPling() {
  try {
    const win = window as unknown as AudioContextWindow;
    const AudioCtor = win.AudioContext ?? win.webkitAudioContext;

    if (!AudioCtor) {
      return;
    }

    const ctx = (context ??= new AudioCtor());

    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1320, now);
    oscillator.frequency.exponentialRampToValueAtTime(1760, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  } catch {
    // Sound is optional; a blocked or missing audio device must not affect the shell.
  }
}
