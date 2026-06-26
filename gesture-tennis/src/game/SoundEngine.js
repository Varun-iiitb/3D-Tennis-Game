// SoundEngine — procedural audio via Web Audio API, zero audio files required
//
// AudioContext must be created (or resumed) from a user-gesture callback to
// satisfy browser autoplay policy; call resume() from any click/gesture handler.
// All methods are safe to call before resume() — they are silently skipped
// until the context is running.

// Master volume — low enough to avoid startling, high enough to give feedback
const BASE_GAIN = 0.16;

// Duration constants (seconds) kept here so they are easy to tweak without
// hunting through oscillator setup code
const HIT_DUR    = 0.13;
const BOUNCE_DUR = 0.18;

export class SoundEngine {
  constructor() {
    // Deferred — created on first resume() to satisfy autoplay policy
    this._ctx = null;
  }

  // Unlock / create the AudioContext.
  // Call once from any synchronous user-input handler (gesture, click, etc.)
  resume() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
  }

  // ─── public sound API ────────────────────────────────────────────────────────

  // Short sharp impact ping on player/opponent ball contact.
  // power [0-1] — scales frequency so harder swings sound more forceful
  hit(power = 0.5) {
    if (!this._ready()) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Frequency range: 400 Hz (soft tap) → 760 Hz (full-power smash)
    const freq = 400 + power * 360;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Pitch drops quickly after attack to simulate a thwack rather than a tone
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.48, now + HIT_DUR);

    gain.gain.setValueAtTime(BASE_GAIN * (0.65 + power * 0.55), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + HIT_DUR);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + HIT_DUR);
  }

  // Dull thud when ball bounces on court surface.
  bounce() {
    if (!this._ready()) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Low-pass filter removes the 'tonal' quality so it sounds like a thud
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;   // only sub-harmonics pass through

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Pitch drops sharply to simulate the elastic bounce contact
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + BOUNCE_DUR);

    gain.gain.setValueAtTime(BASE_GAIN * 0.95, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + BOUNCE_DUR);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + BOUNCE_DUR);
  }

  // Crowd noise burst — filtered white noise that swells and fades.
  // duration — seconds the noise lasts (default 1.2 s)
  cheer(duration = 1.2) {
    if (!this._ready()) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Fill an AudioBuffer with white noise; real crowd is spectrally similar
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Band-pass centred around 1.8 kHz — gives the 'crowd' timbre
    const filter    = ctx.createBiquadFilter();
    filter.type     = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value  = 0.55;

    const gain = ctx.createGain();
    // Swell in quickly, sustain, then decay
    const peak = duration * 0.25;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(BASE_GAIN * 0.65, now + peak);
    gain.gain.setValueAtTime(BASE_GAIN * 0.65, now + duration * 0.65);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  // Ascending four-note arpeggio — plays on match win to punctuate the moment
  fanfare() {
    if (!this._ready()) return;
    const ctx   = this._ctx;
    // C5 E5 G5 C6 — a simple major triad with octave finish
    const notes = [523.25, 659.25, 783.99, 1046.50];
    // Space notes 130 ms apart so each is audible without sounding rushed
    const step  = 0.13;
    notes.forEach((freq, i) => {
      const t    = ctx.currentTime + i * step;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';  // triangle wave is warmer than sawtooth for fanfare
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(BASE_GAIN * 0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.38);
    });
    // Follow-up crowd cheer after the last note
    setTimeout(() => this.cheer(2.0), notes.length * step * 1000 + 100);
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  // Returns true only when AudioContext is running (not suspended / absent)
  _ready() {
    return this._ctx && this._ctx.state === 'running';
  }
}
