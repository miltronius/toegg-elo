// ── Scratch sound ───────────────────────────────────────────────────────────
//
// Wires `scratchSynth.ts` into Web Audio for the banner's easter egg. The
// needle runs in an AudioWorklet so it can play the record backwards, which an
// AudioBufferSourceNode cannot. Nothing here is required for scratching to
// work: without Web Audio, or if the worklet fails to load, the strip still
// drags - silently.

import {
  AHH_ONSET_SECONDS,
  renderNeedle,
  synthesizeAhh,
} from "./scratchSynth";

const PROCESSOR_NAME = "toegg-scratch";
const VOLUME = 0.6;
/** Time constant of the fade while a flicked strip coasts. */
const COAST_FADE_TAU_SECONDS = 0.35;
/** Let the audio device sleep once the record has been still this long. */
const SLEEP_AFTER_MS = 2000;

/**
 * The worklet is loaded from a Blob, so it can't import `renderNeedle` - it
 * gets the function's source instead. `scratchSynth.test.ts` checks that the
 * function still runs on its own like that.
 */
const PROCESSOR_SOURCE = `
const renderNeedle = (${renderNeedle.toString()});

class ScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.record = null;
    this.state = { position: 0, rate: 0 };
    this.target = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.record) this.record = data.record;
      if (typeof data.drop === "number") {
        this.state.position = data.drop;
        this.state.rate = 0;
        this.target = data.drop;
      }
      if (typeof data.target === "number") this.target = data.target;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (this.record && out) {
      renderNeedle(this.state, this.target, this.record, sampleRate, out);
    }
    return true;
  }
}

registerProcessor("${PROCESSOR_NAME}", ScratchProcessor);
`;

export interface ScratchVoice {
  /** Puts the needle back on the vowel's onset, at full volume. */
  drop(): void;
  /** Moves the record under the needle, in seconds since the last drop. */
  moveTo(seconds: number): void;
  /** Fades out while a flicked strip spins down. */
  fadeOut(): void;
  /** The record has stopped; lets the audio device sleep soon. */
  rest(): void;
}

let voice: ScratchVoice | null | undefined;

/**
 * The shared voice, created on first use. **Call it first from a pointer
 * handler**: browsers only let an AudioContext start in response to a gesture.
 * Returns null where Web Audio worklets aren't available.
 */
export function scratchVoice(): ScratchVoice | null {
  if (voice === undefined) voice = createVoice();
  return voice;
}

function createVoice(): ScratchVoice | null {
  if (
    typeof AudioContext === "undefined" ||
    typeof AudioWorkletNode === "undefined"
  ) {
    return null;
  }

  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);

  // Messages before the worklet has loaded are dropped; the first grab after a
  // page load may lose its first few milliseconds of sound.
  let node: AudioWorkletNode | null = null;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;

  const url = URL.createObjectURL(
    new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }),
  );
  context.audioWorklet
    .addModule(url)
    .then(() => {
      node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      const record = synthesizeAhh(context.sampleRate);
      node.port.postMessage({ record, drop: AHH_ONSET_SECONDS }, [
        record.buffer,
      ]);
      node.connect(gain);
    })
    .catch(() => {
      // No worklet, no sound; scratching still works.
    })
    .finally(() => URL.revokeObjectURL(url));

  const glideGain = (to: number, tau: number) => {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(to, now, tau);
  };

  return {
    drop() {
      clearTimeout(sleepTimer);
      void context.resume();
      node?.port.postMessage({ drop: AHH_ONSET_SECONDS });
      glideGain(VOLUME, 0.005);
    },
    moveTo(seconds) {
      node?.port.postMessage({ target: AHH_ONSET_SECONDS + seconds });
    },
    fadeOut() {
      glideGain(0, COAST_FADE_TAU_SECONDS);
    },
    rest() {
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => void context.suspend(), SLEEP_AFTER_MS);
    },
  };
}
