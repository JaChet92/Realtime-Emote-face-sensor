const PROFILES_KEY = "face.detect.profiles.v1";
const LEGACY_KEY = "face.detect.memory.v1";
export const MATCH_THRESHOLD = 0.16;
export const DUPLICATE_THRESHOLD = 0.075;
export const LEARN_SAMPLES = 24;
const PATCH_SIZE = 16;
const VISUAL_WEIGHT = 0.12;
let patchCanvas = null;
let patchCtx = null;

function validVector(v) {
  return Array.isArray(v) && v.length > 20 && v.every(Number.isFinite);
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanProfile(profile, fallbackIndex) {
  if (!validVector(profile?.template)) return null;
  const fallbackName = `usr${fallbackIndex + 1}`;
  const nickname = String(profile.nickname || fallbackName).trim() || fallbackName;
  return {
    id: String(profile.id || makeId()),
    nickname: nickname.slice(0, 24),
    template: profile.template,
    sampleCount: Number(profile.sampleCount || 0),
    image: typeof profile.image === "string" ? profile.image : "",
    createdAt: Number(profile.createdAt || Date.now()),
  };
}

function normalizeProfiles(raw) {
  return Array.isArray(raw)
    ? raw.map(cleanProfile).filter(Boolean)
    : [];
}

function writeProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function cropBox(sourceCtx, box) {
  const width = sourceCtx.canvas.width;
  const height = sourceCtx.canvas.height;
  const [x1, y1, x2, y2] = box;
  const sx = Math.max(0, Math.min(width - 1, x1));
  const sy = Math.max(0, Math.min(height - 1, y1));
  const ex = Math.max(sx + 1, Math.min(width, x2));
  const ey = Math.max(sy + 1, Math.min(height, y2));
  return [sx, sy, ex - sx, ey - sy];
}

function visualEmbedding(sourceCtx, box) {
  if (!sourceCtx || !box || typeof document === "undefined") return [];

  if (!patchCanvas) {
    patchCanvas = document.createElement("canvas");
    patchCanvas.width = PATCH_SIZE;
    patchCanvas.height = PATCH_SIZE;
    patchCtx = patchCanvas.getContext("2d", { willReadFrequently: true });
  }

  const [x, y, w, h] = cropBox(sourceCtx, box);
  patchCtx.clearRect(0, 0, PATCH_SIZE, PATCH_SIZE);
  patchCtx.drawImage(sourceCtx.canvas, x, y, w, h, 0, 0, PATCH_SIZE, PATCH_SIZE);

  const data = patchCtx.getImageData(0, 0, PATCH_SIZE, PATCH_SIZE).data;
  const vals = [];
  for (let i = 0; i < data.length; i += 4) {
    vals.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255);
  }

  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance) || 1;
  return vals.map(v => ((v - mean) / std) * VISUAL_WEIGHT);
}

export function faceEmbedding(lms, sourceCtx = null, box = null) {
  if (!lms || lms.length < 20) return null;

  const xs = lms.map(p => p.x);
  const ys = lms.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.hypot(maxX - minX, maxY - minY) || 1;
  const step = Math.max(1, Math.floor(lms.length / 64));
  const out = [];

  for (let i = 0; i < lms.length; i += step) {
    const p = lms[i];
    out.push((p.x - cx) / scale, (p.y - cy) / scale);
  }

  return out.concat(visualEmbedding(sourceCtx, box));
}

export function averageEmbeddings(samples) {
  const good = samples.filter(validVector);
  if (!good.length) return null;

  const len = Math.min(...good.map(v => v.length));
  const avg = Array(len).fill(0);
  good.forEach(v => {
    for (let i = 0; i < len; i++) avg[i] += v[i];
  });
  return avg.map(v => v / good.length);
}

export function embeddingDistance(a, b) {
  if (!validVector(a) || !validVector(b)) return Infinity;
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / len);
}

export function findRememberedFaces(embeddings, profiles, threshold = MATCH_THRESHOLD) {
  const candidates = [];
  profiles.forEach(profile => {
    embeddings.forEach((embedding, index) => {
      const distance = embeddingDistance(embedding, profile.template);
      if (distance <= threshold) candidates.push({ index, profile, distance });
    });
  });

  candidates.sort((a, b) => a.distance - b.distance);

  const usedFaces = new Set();
  const usedProfiles = new Set();
  const matches = [];

  candidates.forEach(match => {
    if (usedFaces.has(match.index) || usedProfiles.has(match.profile.id)) return;
    usedFaces.add(match.index);
    usedProfiles.add(match.profile.id);
    matches.push(match);
  });

  return { matches, matchedIndices: usedFaces };
}

export function captureFaceImage(sourceCtx, box, size = 96) {
  if (!sourceCtx || !box || typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;
  const [x, y, w, h] = cropBox(sourceCtx, box);
  ctx.drawImage(sourceCtx.canvas, x, y, w, h, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function nextNickname(profiles) {
  const names = new Set(profiles.map(p => p.nickname));
  let n = profiles.length + 1;
  while (names.has(`usr${n}`)) n++;
  return `usr${n}`;
}

function findDuplicateProfile(profiles, template, threshold = DUPLICATE_THRESHOLD) {
  let best = null;
  let bestDistance = Infinity;

  profiles.forEach(profile => {
    const distance = embeddingDistance(template, profile.template);
    if (distance < bestDistance) {
      best = profile;
      bestDistance = distance;
    }
  });

  return bestDistance <= threshold ? { profile: best, distance: bestDistance } : null;
}

export function loadFaceProfiles() {
  try {
    const profiles = normalizeProfiles(JSON.parse(localStorage.getItem(PROFILES_KEY)));
    if (profiles.length) return profiles;

    const legacy = cleanProfile(JSON.parse(localStorage.getItem(LEGACY_KEY)), 0);
    if (!legacy) return [];
    legacy.nickname = "usr1";
    const migrated = [legacy];
    writeProfiles(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function addFaceProfile(profiles, template, sampleCount, image = "") {
  if (!validVector(template)) return { profiles, profile: null };
  const cleaned = normalizeProfiles(profiles);
  const duplicate = findDuplicateProfile(cleaned, template);
  if (duplicate) {
    return {
      profiles: cleaned,
      profile: duplicate.profile,
      duplicate: true,
      distance: duplicate.distance,
    };
  }

  const profile = {
    id: makeId(),
    nickname: nextNickname(cleaned),
    template,
    sampleCount,
    image,
    createdAt: Date.now(),
  };
  const updated = [...cleaned, profile];
  writeProfiles(updated);
  return { profiles: updated, profile, duplicate: false };
}

export function updateFaceProfile(profiles, id, patch) {
  const updated = normalizeProfiles(profiles).map(profile => {
    if (profile.id !== id) return profile;
    const nickname = String(patch.nickname ?? profile.nickname).trim() || profile.nickname;
    return { ...profile, nickname: nickname.slice(0, 24) };
  });
  writeProfiles(updated);
  return updated;
}

export function deleteFaceProfile(profiles, id) {
  const updated = normalizeProfiles(profiles).filter(profile => profile.id !== id);
  writeProfiles(updated);
  return updated;
}

export function clearFaceProfiles() {
  localStorage.removeItem(PROFILES_KEY);
  localStorage.removeItem(LEGACY_KEY);
}
