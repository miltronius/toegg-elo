// ── The record under the banner's needle ────────────────────────────────────
//
// Pure sample math for the banner's scratch easter egg (see `turntable.ts`):
// the "ahh" it plays, and the needle that plays it at whatever speed and
// direction the hand moves. No Web Audio here - `scratchAudio.ts` wires these
// into an AudioContext.

/** Silence before the vowel. The needle drops here on every grab. */
export const AHH_ONSET_SECONDS = 0.1;

const VOWEL_SECONDS = 0.45;
/** Silence after the vowel, so the loop seam falls in quiet. */
const TAIL_SECONDS = 0.15;
const ATTACK_SECONDS = 0.012;
const RELEASE_SECONDS = 0.18;
const PEAK = 0.9;

/** A spoken "ahh" falls in pitch; the vibrato keeps it from sounding like a synth. */
const PITCH_FROM_HZ = 165;
const PITCH_TO_HZ = 125;
const VIBRATO_HZ = 5.5;
const VIBRATO_DEPTH = 0.015;
/** Harmonics above this add fizz, not vowel. */
const HARMONIC_CEILING_HZ = 5000;

/** Vocal tract resonances of an open "ah": centre, bandwidth, gain. */
const FORMANTS = [
  { hz: 730, width: 90, gain: 1 },
  { hz: 1090, width: 110, gain: 0.6 },
  { hz: 2440, width: 170, gain: 0.25 },
];

/** How loudly the vocal tract passes a harmonic at `hz`. */
function formantGain(hz: number): number {
  let gain = 0.02;
  for (const f of FORMANTS) {
    const x = (hz - f.hz) / (f.width / 2);
    gain += f.gain / Math.sqrt(1 + x * x);
  }
  return gain;
}

/** 0 → 1 → 0 over the vowel, with smooth (raised-cosine) ends. */
function envelope(t: number): number {
  if (t < ATTACK_SECONDS) {
    return 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK_SECONDS);
  }
  const untilEnd = VOWEL_SECONDS - t;
  if (untilEnd < RELEASE_SECONDS) {
    return 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, untilEnd)) / RELEASE_SECONDS);
  }
  return 1;
}

/**
 * The classic scratch sample: a sung "ahh", built as a buzz of harmonics shaped
 * by the formants of the vowel. Laid out as silence, vowel, silence, so a
 * needle dropped on the onset speaks on the first push.
 */
export function synthesizeAhh(sampleRate: number): Float32Array {
  const onset = Math.round(AHH_ONSET_SECONDS * sampleRate);
  const vowel = Math.round(VOWEL_SECONDS * sampleRate);
  const out = new Float32Array(
    onset + vowel + Math.round(TAIL_SECONDS * sampleRate),
  );
  const ceiling = Math.min(HARMONIC_CEILING_HZ, sampleRate * 0.45);

  let phase = 0;
  let loudest = 0;
  for (let i = 0; i < vowel; i++) {
    const t = i / sampleRate;
    const glide = PITCH_FROM_HZ + (PITCH_TO_HZ - PITCH_FROM_HZ) * (t / VOWEL_SECONDS);
    const f0 = glide * (1 + VIBRATO_DEPTH * Math.sin(2 * Math.PI * VIBRATO_HZ * t));
    phase += (2 * Math.PI * f0) / sampleRate;

    let value = 0;
    for (let k = 1; k * f0 < ceiling; k++) {
      // 1/k is the natural roll-off of a voice before the vowel shapes it.
      value += (formantGain(k * f0) / k) * Math.sin(k * phase);
    }
    value *= envelope(t);
    out[onset + i] = value;
    loudest = Math.max(loudest, Math.abs(value));
  }

  if (loudest > 0) {
    for (let i = onset; i < onset + vowel; i++) out[i] *= PEAK / loudest;
  }
  return out;
}

export interface NeedleState {
  /** Seconds into the record, unwrapped (it loops). */
  position: number;
  /** Current playback speed; negative plays backwards. */
  rate: number;
}

/**
 * Renders one block of the record under a needle chasing `target`, the
 * position the hand has put the record at. Following a position rather than
 * being told a speed is what makes a still hand silent and lets the needle
 * glide between pointer events instead of stepping.
 *
 * **Runs inside the audio worklet as source text** (`scratchAudio.ts` sends
 * it `renderNeedle.toString()`), so it must not reach outside its own body -
 * which is why its constants are declared here rather than at module level.
 */
export function renderNeedle(
  state: NeedleState,
  target: number,
  record: Float32Array,
  sampleRate: number,
  out: Float32Array,
): void {
  // How hard the needle is pulled towards the hand, per second of lag. Kept
  // below 1 / (4 * RATE_TAU_SECONDS) so it arrives without overshooting.
  const FOLLOW_HZ = 30;
  // Smooths speed changes so pointer-event steps don't zipper.
  const RATE_TAU_SECONDS = 0.005;
  // Speed at which the record is at full volume; slower is quieter, and a
  // still record silent - roughly how a phono cartridge behaves.
  const FULL_VOLUME_RATE = 0.5;

  const smoothing = 1 - Math.exp(-1 / (sampleRate * RATE_TAU_SECONDS));
  const length = record.length;
  for (let i = 0; i < out.length; i++) {
    const desired = (target - state.position) * FOLLOW_HZ;
    state.rate += (desired - state.rate) * smoothing;
    state.position += state.rate / sampleRate;

    const at = state.position * sampleRate;
    const index = Math.floor(at);
    const a = record[((index % length) + length) % length];
    const b = record[(((index + 1) % length) + length) % length];
    const volume = Math.min(1, Math.abs(state.rate) / FULL_VOLUME_RATE);
    out[i] = (a + (b - a) * (at - index)) * volume;
  }
}
