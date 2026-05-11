// ── paths ────────────────────────────────────────────────────────────────────
export const MODEL_LOCAL = "./face_landmarker.task";   // optional: drop in repo root to skip CDN
export const MODEL_CDN   = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
export const WASM_CDN    = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
export const ASSET_BASE  = "./assets/";

export const EMOJI_FILES = {
  angry:    "Angry.jpeg",
  laughing: "Laughing.png",
  thinking: "Thinking.webp",
  shocked:  "shocked.png",
  smile:    "smile.png",
  neutral:  "Neutral.png",
};

export const EMOTIONS = ["smile", "laughing", "shocked", "angry", "thinking", "neutral"];

// ── mediapipe ─────────────────────────────────────────────────────────────────
export const MAX_FACES   = 6;
export const MIN_DETECT  = 0.2;

// ── rendering ─────────────────────────────────────────────────────────────────
export const EMOJI_PAD = 0.18;
export const MIN_BOX   = 10;
export const BLUR_PX   = 42;
export const MOSAIC_BLOCK = 38;
export const MOSAIC_TINT_ALPHA = 0.72;

// ── smoothing / tracking ──────────────────────────────────────────────────────
export const EMA_ALPHA     = 0.30;
export const SWITCH_MARGIN = 0.05;
export const TRACK_DIST    = 100;
