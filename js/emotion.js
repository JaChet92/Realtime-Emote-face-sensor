import { EMOTIONS, EMA_ALPHA, SWITCH_MARGIN } from "./config.js";

// ── helpers ───────────────────────────────────────────────────────────────────
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** Convert MediaPipe blendshapes Classification → plain object { name: score } */
export function bsDict(bs) {
  if (!bs) return {};
  const d = {};
  bs.categories.forEach(c => { d[c.categoryName] = c.score; });
  return d;
}

/** Compute raw emotion scores from a blendshape dict */
export function emoScores(bs) {
  const g = k => bs[k] || 0;

  const jawOpen    = g("jawOpen");
  const smile      = 0.5 * (g("mouthSmileLeft")  + g("mouthSmileRight"));
  const eyeWide    = 0.5 * (g("eyeWideLeft")      + g("eyeWideRight"));
  const eyeSquint  = 0.5 * (g("eyeSquintLeft")    + g("eyeSquintRight"));
  const browDown   = 0.5 * (g("browDownLeft")     + g("browDownRight"));
  const browInner  = g("browInnerUp");
  const mouthPress = 0.5 * (g("mouthPressLeft")   + g("mouthPressRight"));
  const mouthFrown = 0.5 * (g("mouthFrownLeft")   + g("mouthFrownRight"));
  const mouthPuck  = g("mouthPucker");

  const s = {
    smile:    clamp(0.80 * smile     + 0.20 * (1 - jawOpen)),
    laughing: clamp(0.60 * smile     + 0.85 * jawOpen    + 0.30 * eyeSquint),
    shocked:  clamp(0.80 * jawOpen   + 0.60 * eyeWide    + 0.40 * browInner - 0.20 * smile),
    angry:    clamp(0.70 * browDown  + 0.50 * mouthPress + 0.40 * mouthFrown),
    thinking: clamp(0.85 * mouthPuck + 0.40 * browInner  + 0.30 * mouthPress),
  };

  const peak = Math.max(...Object.values(s));
  s.neutral = clamp(0.70 - peak);
  return s;
}

/** Apply EMA smoothing in-place to an existing score dict */
export function applyEMA(ema, raw) {
  for (const [e, s] of Object.entries(raw))
    ema[e] = (1 - EMA_ALPHA) * ema[e] + EMA_ALPHA * s;
}

/** Return a fresh zeroed EMA state for one face */
export function newEMA() {
  return Object.fromEntries(EMOTIONS.map(e => [e, 0]));
}

/** Pick the dominant emotion, with hysteresis to prevent rapid switching */
export function pickEmo(smoothed, prev) {
  const cand = Object.entries(smoothed).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  if (!prev) return cand;
  if (cand !== prev && smoothed[cand] < (smoothed[prev] || 0) + SWITCH_MARGIN) return prev;
  return cand;
}
