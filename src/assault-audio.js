// Small procedural ship-interior effects; no downloads and no autoplay before a gesture.
export class AssaultAudio {
  constructor() { this.enabled = true; this.context = null; this.voices = new Set(); }

  unlock() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      this.context ||= new AudioContext();
      this.context.resume()?.catch(() => {});
    } catch { /* Audio is optional; never block the game. */ }
  }

  tone(from, to, duration, volume, type = "sine") {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== "running") return;
    const voice = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    voice.type = type;
    voice.frequency.setValueAtTime(from, now);
    voice.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    voice.connect(gain).connect(ctx.destination);
    this.voices.add(voice);
    voice.onended = () => { this.voices.delete(voice); voice.disconnect(); gain.disconnect(); };
    voice.start();
    voice.stop(now + duration);
  }

  play(stage) {
    if (stage === 'player-fire') {this.tone(130,35,.2,.09,'sawtooth');this.tone(780,180,.08,.025,'triangle');}
    if (stage === 'armor-hit') {this.tone(310,70,.22,.065,'triangle');this.tone(75,35,.25,.07);}
    if (stage === 'armor-ricochet') this.tone(1350,420,.12,.035,'triangle');
    if (stage === 'armor-break') {this.tone(90,24,.7,.14);this.tone(390,55,.4,.06,'sawtooth');}
    if (stage === "enemy-charge") this.tone(160, 470, 1.4, 0.035, "triangle");
    if (stage === "enemy-lock") this.tone(920, 600, 0.25, 0.06, "square");
    if (stage === "enemy-fire") this.tone(180, 38, 0.45, 0.11, "sawtooth");
    if (stage === "enemy-hit") { this.tone(95, 22, .55, .15); this.tone(620, 90, .15, .04, "triangle"); }
    if (stage === "jammed") this.tone(210,55,.6,.11,"sawtooth");
    if (stage === "rebound") this.tone(120,35,.7,.12,"triangle");
    if (stage === "defeated") this.tone(180, 35, 1, .08, "triangle");
    if (stage === "harpoon") this.tone(640, 90, 0.45, 0.09, "triangle");
    if (stage === "tethered") this.tone(180, 55, 0.22, 0.08);
    if (stage === "ram-deploy") this.tone(210, 75, 0.8, 0.07, "triangle");
    if (stage === "charge") this.tone(48, 190, 2.4, 0.12, "triangle");
    if (stage === "impact") {
      this.stop();
      this.tone(100, 27, 0.7, 0.22);
      this.tone(460, 60, 0.24, 0.06, "sawtooth");
    }
    if (stage === "clamp") this.tone(140, 42, 0.35, 0.1, "triangle");
    if (stage === "ready") this.tone(540, 820, 0.3, 0.035);
  }

  stop() { for (const voice of this.voices) { try { voice.stop(); } catch {} } }
  toggle() { this.enabled = !this.enabled; if (!this.enabled) this.stop(); else this.unlock(); return this.enabled; }
  destroy() { this.stop(); this.context?.close().catch(() => {}); }
}
