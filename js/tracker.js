import { EMOJI_PAD, TRACK_DIST } from "./config.js";
import { clamp } from "./emotion.js";

/** Convert normalized face landmarks → pixel bbox, mirrored for selfie view */
export function bboxMirrored(lms, W, H, pad = EMOJI_PAD) {
  const xs = lms.map(p => p.x);
  const ys = lms.map(p => p.y);
  const nx1 = Math.min(...xs), nx2 = Math.max(...xs);
  const ny1 = Math.min(...ys), ny2 = Math.max(...ys);
  const nbw = nx2 - nx1, nbh = ny2 - ny1;

  // mirror x: mirrored_x = 1 - x  →  box flips: [1-(nx2+pad), 1-(nx1-pad)]
  return [
    clamp(1 - (nx2 + pad * nbw)) * W,
    clamp(ny1 - pad * nbh)        * H,
    clamp(1 - (nx1 - pad * nbw)) * W,
    clamp(ny2 + pad * nbh)        * H,
  ];
}

const boxCenter = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
const dist      = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Greedy nearest-neighbour matching: assign stable IDs to detected faces.
 * @param {Object} prev  { trackId: box }  from the previous frame
 * @param {Array}  boxes  [ [x1,y1,x2,y2], ... ]  current detections
 * @returns {Object}  { detectionIndex: trackId }
 */
export function assignTracks(prev, boxes) {
  const out = {}, used = new Set();
  let next = Object.keys(prev).length
    ? Math.max(...Object.keys(prev).map(Number)) + 1
    : 0;

  boxes.forEach((box, i) => {
    const c = boxCenter(box);
    let bestId = null, bestD = Infinity;

    for (const [t, pb] of Object.entries(prev)) {
      const tid = Number(t);
      if (used.has(tid)) continue;
      const d = dist(c, boxCenter(pb));
      if (d < bestD) { bestD = d; bestId = tid; }
    }

    if (bestId !== null && bestD <= TRACK_DIST) {
      out[i] = bestId;
      used.add(bestId);
    } else {
      out[i] = next++;
    }
  });

  return out;
}
