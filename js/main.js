import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

import {
  MODEL_LOCAL,
  MODEL_CDN,
  WASM_CDN,
  ASSET_BASE,
  EMOJI_FILES,
  GENERATED_EMOTIONS,
  MAX_FACES,
  MIN_DETECT,
  MIN_BOX,
  BLUR_PX,
  MOSAIC_BLOCK,
  MOSAIC_TINT_ALPHA,
} from "./config.js";

import { bsDict, emoScores, applyEMA, newEMA, pickEmo } from "./emotion.js";
import { createGeneratedEmoji } from "./generatedEmoji.js";
import { bboxMirrored, assignTracks } from "./tracker.js";
import {
  addFaceProfile,
  averageEmbeddings,
  captureFaceImage,
  clearFaceProfiles,
  deleteFaceProfile,
  faceEmbedding,
  findRememberedFaces,
  LEARN_SAMPLES,
  loadFaceProfiles,
  MATCH_THRESHOLD,
  updateFaceProfile,
} from "./recognition.js";
import {
  clearRecordings,
  deleteRecording,
  downloadBlob,
  listRecordings,
  makeRecordingName,
  saveRecording,
} from "./recordings.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("start-btn");
const initMsg = document.getElementById("init-msg");
const recLabel = document.getElementById("rec-label");
const sFaces = document.getElementById("s-faces");
const sFps = document.getElementById("s-fps");
const footStatus = document.getElementById("footer-status");

const privacyTarget = document.getElementById("privacy-target");
const privacyEffect = document.getElementById("privacy-effect");
const memoryState = document.getElementById("memory-state");
const learnBtn = document.getElementById("learn-btn");
const clearMemBtn = document.getElementById("clear-memory-btn");
const learnStatus = document.getElementById("learn-status");
const learnProgress = document.getElementById("learn-progress");
const profileList = document.getElementById("profile-list");
const recordBtn = document.getElementById("record-btn");
const recordState = document.getElementById("record-state");
const recordingSummary = document.getElementById("recording-summary");
const recordingList = document.getElementById("recording-list");
const exportAllBtn = document.getElementById("export-all-btn");
const clearRecordingsBtn = document.getElementById("clear-recordings-btn");

// canvases
const canvasMain = document.getElementById("canvas-main");
const ctxMain = canvasMain.getContext("2d");
const canvasLeft = document.getElementById("canvas-left");
const ctxLeft = canvasLeft.getContext("2d");
const canvasRight = document.getElementById("canvas-right");
const ctxRight = canvasRight.getContext("2d");
const canvasLearn = document.getElementById("canvas-learn");
const ctxLearn = canvasLearn.getContext("2d");
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
const mosaicCanvas = document.createElement("canvas");
const mosaicCtx = mosaicCanvas.getContext("2d", { willReadFrequently: true });

// nav
const navBtns = document.querySelectorAll(".nav-btn");
const compareTab = document.getElementById("compare-tab");
const rememberTab = document.getElementById("remember-tab");
const pages = document.querySelectorAll(".page");

// ── page switching ────────────────────────────────────────────────────────────
let currentPage = "single";

function switchPage(page) {
  const btn = [...navBtns].find((b) => b.dataset.page === page);
  if (btn?.disabled) return;
  currentPage = page;
  navBtns.forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  pages.forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
}

navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchPage(btn.dataset.page);
  });
});

// ── tracking state ────────────────────────────────────────────────────────────
let scoreEma = {},
  emoState = {},
  prevTracks = {};
let running = false,
  lastT = 0,
  frameN = 0;

// ── privacy + memory UI ───────────────────────────────────────────────────────
let targetMode = privacyTarget.value;
let maskStyle = privacyEffect.value;
let faceProfiles = loadFaceProfiles();
let learning = false;
let learnSamples = [];
let learnImage = "";
let lastLearnSampleAt = 0;
let profileRenderKey = "";

privacyTarget.addEventListener("change", () => {
  targetMode = privacyTarget.value;
  updateMemoryUi();
});

privacyEffect.addEventListener("change", () => {
  maskStyle = privacyEffect.value;
});

learnBtn.addEventListener("click", () => {
  if (!running) return;
  learning = true;
  learnSamples = [];
  learnImage = "";
  lastLearnSampleAt = 0;
  learnProgress.style.width = "0%";
  learnStatus.textContent = "LOOK AT CAMERA";
  updateMemoryUi();
});

clearMemBtn.addEventListener("click", () => {
  clearFaceProfiles();
  faceProfiles = [];
  learnProgress.style.width = "0%";
  learnStatus.textContent = running ? "MEMORY CLEARED" : "START CAMERA FIRST";
  updateMemoryUi();
});

profileList.addEventListener("input", (event) => {
  if (!event.target.matches(".profile-name")) return;
  faceProfiles = updateFaceProfile(faceProfiles, event.target.dataset.id, {
    nickname: event.target.value,
  });
  updateMemoryUi(null, false);
});

profileList.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-delete-profile]");
  if (!removeBtn) return;
  faceProfiles = deleteFaceProfile(
    faceProfiles,
    removeBtn.dataset.deleteProfile,
  );
  learnStatus.textContent = faceProfiles.length
    ? "PROFILE DELETED"
    : "NO MEMORY";
  updateMemoryUi();
});

function renderProfiles(force = false) {
  const renderKey = JSON.stringify(
    faceProfiles.map((p) => [p.id, p.nickname, p.image]),
  );
  if (!force && renderKey === profileRenderKey) return;
  profileRenderKey = renderKey;

  profileList.innerHTML = "";

  if (!faceProfiles.length) {
    const empty = document.createElement("div");
    empty.className = "profile-empty";
    empty.textContent = "NO SAVED PROFILES";
    profileList.append(empty);
    return;
  }

  faceProfiles.forEach((profile) => {
    const item = document.createElement("div");
    item.className = "profile-card";

    const img = document.createElement("img");
    img.className = "profile-img";
    img.alt = "";
    img.src = profile.image || "assets/Neutral.png";

    const input = document.createElement("input");
    input.className = "profile-name";
    input.dataset.id = profile.id;
    input.value = profile.nickname;
    input.maxLength = 24;
    input.autocomplete = "off";

    const del = document.createElement("button");
    del.className = "profile-delete";
    del.type = "button";
    del.dataset.deleteProfile = profile.id;
    del.textContent = "X";
    del.title = "Delete profile";

    item.append(img, input, del);
    profileList.append(item);
  });
}

function updateMemoryUi(matchSet = null, renderProfileList = true) {
  const count = faceProfiles.length;
  if (!count) {
    memoryState.textContent = "MEMORY EMPTY";
  } else if (targetMode === "remembered" && matchSet) {
    memoryState.textContent = matchSet.matches.length
      ? `MATCH ${matchSet.matches.length}/${count}`
      : `NO MATCH / ${count}`;
  } else {
    memoryState.textContent = `MEMORY ${count}`;
  }

  learnBtn.disabled = !running || learning;
  clearMemBtn.disabled = !faceProfiles.length || learning;
  if (renderProfileList) renderProfiles();
}

updateMemoryUi();

// ── recording UI ──────────────────────────────────────────────────────────────
let recordings = [];
let recordingUrls = new Map();
let mediaRecorder = null;
let recordChunks = [];
let recordStartedAt = 0;
let recordTimer = null;
let recording = false;
let recordPoster = "";

function canRecordCanvas() {
  return Boolean(window.MediaRecorder && canvasMain.captureStream);
}

function preferredMimeType() {
  const options = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function fmtBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function updateRecordUi() {
  recordBtn.disabled = !running || !canRecordCanvas();
  recordBtn.textContent = recording ? "[ STOP REC ]" : "[ START REC ]";
  recordState.classList.toggle("is-recording", recording);

  if (!canRecordCanvas()) {
    recordState.textContent = "REC UNSUPPORTED";
  } else if (recording) {
    recordState.textContent = `REC ${fmtDuration(performance.now() - recordStartedAt)}`;
  } else {
    recordState.textContent = "REC OFF";
  }
}

function renderRecordingList() {
  recordingUrls.forEach((url) => URL.revokeObjectURL(url));
  recordingUrls.clear();
  recordingList.innerHTML = "";

  recordingSummary.textContent = `${recordings.length} CLIP${recordings.length === 1 ? "" : "S"}`;
  exportAllBtn.disabled = !recordings.length;
  clearRecordingsBtn.disabled = !recordings.length;

  if (!recordings.length) {
    const empty = document.createElement("div");
    empty.className = "recording-empty";
    empty.textContent = "NO RECORDED VIDEO";
    recordingList.append(empty);
    return;
  }

  recordings.forEach((recordingItem) => {
    const card = document.createElement("div");
    card.className = "recording-card";

    const clip = document.createElement("video");
    const url = URL.createObjectURL(recordingItem.blob);
    recordingUrls.set(recordingItem.id, url);
    clip.src = url;
    if (recordingItem.poster) clip.poster = recordingItem.poster;
    clip.controls = true;
    clip.playsInline = true;
    clip.preload = "metadata";

    const meta = document.createElement("div");
    meta.className = "recording-meta";
    const date = new Date(recordingItem.createdAt).toLocaleString();
    meta.innerHTML = `<span>${fmtDuration(recordingItem.durationMs)}</span><span>${fmtBytes(recordingItem.blob.size)}</span>`;

    const name = document.createElement("div");
    name.className = "compare-label";
    name.textContent = `// ${date}`;

    const actions = document.createElement("div");
    actions.className = "recording-actions";

    const exportBtn = document.createElement("button");
    exportBtn.className = "panel-btn";
    exportBtn.type = "button";
    exportBtn.dataset.exportRecording = recordingItem.id;
    exportBtn.textContent = "[ EXPORT ]";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "panel-btn subtle";
    deleteBtn.type = "button";
    deleteBtn.dataset.deleteRecording = recordingItem.id;
    deleteBtn.textContent = "[ DELETE ]";

    actions.append(exportBtn, deleteBtn);
    card.append(clip, name, meta, actions);
    recordingList.append(card);
  });
}

async function refreshRecordings() {
  try {
    recordings = await listRecordings();
    renderRecordingList();
  } catch (err) {
    recordingSummary.textContent = "PREVIEW ERR";
    footStatus.textContent = String(err?.message || err).slice(0, 48);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function capturePoster() {
  try {
    if (!canvasMain.width || !canvasMain.height) return "";
    return canvasMain.toDataURL("image/jpeg", 0.82);
  } catch {
    return "";
  }
}

function recordingStream() {
  const stream = canvasMain.captureStream(30);
  const source = video.srcObject;
  if (source instanceof MediaStream) {
    source.getAudioTracks().forEach((track) => stream.addTrack(track));
  }
  return stream;
}

function startRecording() {
  if (!running || recording || !canRecordCanvas()) return;

  recordPoster = capturePoster();
  const stream = recordingStream();
  const mimeType = preferredMimeType();
  recordChunks = [];
  mediaRecorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  recordStartedAt = performance.now();
  recording = true;

  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) recordChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    const durationMs = performance.now() - recordStartedAt;
    const type = mediaRecorder.mimeType || "video/webm";
    const blob = new Blob(recordChunks, { type });
    const createdAt = Date.now();
    const poster = capturePoster() || recordPoster;

    recording = false;
    clearInterval(recordTimer);
    recordTimer = null;
    updateRecordUi();

    if (blob.size > 0) {
      const item = {
        id: `${createdAt}-${Math.random().toString(16).slice(2)}`,
        name: makeRecordingName(createdAt, type),
        blob,
        poster,
        durationMs,
        createdAt,
        mimeType: type,
      };
      await saveRecording(item);
      await refreshRecordings();
      switchPage("preview");
      footStatus.textContent = "RECORDING SAVED";
    }
  };

  mediaRecorder.start(500);
  recordTimer = setInterval(updateRecordUi, 250);
  updateRecordUi();
  footStatus.textContent = "RECORDING";
}

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording();
  else startRecording();
});

recordingList.addEventListener("click", async (event) => {
  const exportBtn = event.target.closest("[data-export-recording]");
  if (exportBtn) {
    const item = recordings.find(
      (r) => r.id === exportBtn.dataset.exportRecording,
    );
    if (item)
      downloadBlob(
        item.blob,
        item.name || makeRecordingName(item.createdAt, item.mimeType),
      );
    return;
  }

  const deleteBtn = event.target.closest("[data-delete-recording]");
  if (deleteBtn) {
    await deleteRecording(deleteBtn.dataset.deleteRecording);
    await refreshRecordings();
    footStatus.textContent = "RECORDING DELETED";
  }
});

exportAllBtn.addEventListener("click", () => {
  recordings.forEach((item) =>
    downloadBlob(
      item.blob,
      item.name || makeRecordingName(item.createdAt, item.mimeType),
    ),
  );
});

clearRecordingsBtn.addEventListener("click", async () => {
  await clearRecordings();
  await refreshRecordings();
  footStatus.textContent = "RECORDINGS CLEARED";
});

await refreshRecordings();
updateRecordUi();

// ── load emoji images ─────────────────────────────────────────────────────────
const imgs = {};
await Promise.all(
  Object.entries(EMOJI_FILES).map(
    ([k, f]) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          imgs[k] = img;
          res();
        };
        img.onerror = res;
        img.src = ASSET_BASE + f;
      }),
  ),
);

GENERATED_EMOTIONS.forEach((emotion) => {
  const generated = createGeneratedEmoji(emotion);
  if (generated) imgs[emotion] = generated;
});

// ── init mediapipe ────────────────────────────────────────────────────────────
let landmarker;
try {
  const wasm = await FilesetResolver.forVisionTasks(WASM_CDN);

  let modelPath = MODEL_LOCAL;
  try {
    const probe = await fetch(MODEL_LOCAL, { method: "HEAD" });
    if (!probe.ok) modelPath = MODEL_CDN;
  } catch {
    modelPath = MODEL_CDN;
  }

  landmarker = await FaceLandmarker.createFromOptions(wasm, {
    baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: MAX_FACES,
    minFaceDetectionConfidence: MIN_DETECT,
    minFacePresenceConfidence: MIN_DETECT,
    minTrackingConfidence: MIN_DETECT,
    outputFaceBlendshapes: true,
  });

  initMsg.textContent = "MODEL READY - CLICK TO START";
  startBtn.disabled = false;
} catch (err) {
  initMsg.textContent = "ERR: " + String(err.message).slice(0, 48);
  recLabel.textContent = "ERROR";
}

// ── render helpers ────────────────────────────────────────────────────────────
function syncCameraAspect(W, H) {
  if (!W || !H) return;
  document.documentElement.style.setProperty("--camera-aspect", `${W} / ${H}`);
}

function drawMirrored(renderCtx, W, H) {
  if (renderCtx.canvas.width !== W) renderCtx.canvas.width = W;
  if (renderCtx.canvas.height !== H) renderCtx.canvas.height = H;
  renderCtx.save();
  renderCtx.scale(-1, 1);
  renderCtx.drawImage(video, -W, 0);
  renderCtx.restore();
}

function clampBox([x1, y1, x2, y2], W, H) {
  return [
    Math.max(0, Math.min(W, x1)),
    Math.max(0, Math.min(H, y1)),
    Math.max(0, Math.min(W, x2)),
    Math.max(0, Math.min(H, y2)),
  ];
}

function drawEmojiMasks(renderCtx, maskList) {
  maskList.forEach(({ box, emotion, masked, nickname }) => {
    if (!masked) return;
    const [x1, y1, x2, y2] = box;
    const tw = x2 - x1,
      th = y2 - y1;
    const img = imgs[emotion] || imgs.neutral;
    if (tw >= MIN_BOX && th >= MIN_BOX && img)
      renderCtx.drawImage(img, x1, y1, tw, th);
    drawNameLabel(renderCtx, box, nickname);
  });
}

function drawBlurMasks(renderCtx, maskList, W, H) {
  maskList.forEach(({ box, masked, nickname }) => {
    if (!masked) return;
    const [x1, y1, x2, y2] = clampBox(box, W, H);
    const tw = x2 - x1,
      th = y2 - y1;
    if (tw < MIN_BOX || th < MIN_BOX) return;

    const smallW = Math.max(1, Math.ceil(tw / MOSAIC_BLOCK));
    const smallH = Math.max(1, Math.ceil(th / MOSAIC_BLOCK));
    mosaicCanvas.width = smallW;
    mosaicCanvas.height = smallH;

    mosaicCtx.imageSmoothingEnabled = true;
    mosaicCtx.clearRect(0, 0, smallW, smallH);
    mosaicCtx.drawImage(renderCtx.canvas, x1, y1, tw, th, 0, 0, smallW, smallH);

    renderCtx.save();
    renderCtx.beginPath();
    renderCtx.rect(x1, y1, tw, th);
    renderCtx.clip();

    renderCtx.filter = `blur(${BLUR_PX}px)`;
    renderCtx.drawImage(renderCtx.canvas, x1, y1, tw, th, x1, y1, tw, th);
    renderCtx.filter = "none";

    renderCtx.imageSmoothingEnabled = false;
    renderCtx.drawImage(mosaicCanvas, 0, 0, smallW, smallH, x1, y1, tw, th);
    renderCtx.imageSmoothingEnabled = true;

    renderCtx.fillStyle = `rgba(0, 0, 0, ${MOSAIC_TINT_ALPHA})`;
    renderCtx.fillRect(x1, y1, tw, th);
    renderCtx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    renderCtx.lineWidth = 2;
    renderCtx.strokeRect(x1, y1, tw, th);
    renderCtx.restore();
    drawNameLabel(renderCtx, box, masked ? item.nickname : null);
  });
}

function drawNameLabel(renderCtx, box, name) {
  if (!name) return;
  const [x1, y1, x2] = box;
  const w = x2 - x1;
  const fontSize = Math.max(10, Math.min(18, Math.round(w * 0.12)));
  renderCtx.save();
  renderCtx.font = `bold ${fontSize}px "Press Start 2P", monospace`;
  renderCtx.textBaseline = "bottom";
  renderCtx.textAlign = "left";
  const pad = 4;
  const tw = renderCtx.measureText(name).width;
  renderCtx.fillStyle = "rgba(0,0,0,0.65)";
  renderCtx.fillRect(
    x1,
    y1 - fontSize - pad * 2,
    tw + pad * 2,
    fontSize + pad * 2,
  );
  renderCtx.fillStyle = "#fff";
  renderCtx.fillText(name, x1 + pad, y1 - pad);
  renderCtx.restore();
}

function drawMasks(renderCtx, maskList, W, H) {
  if (maskStyle === "blur") drawBlurMasks(renderCtx, maskList, W, H);
  else drawEmojiMasks(renderCtx, maskList);
}

function drawLearnBoxes(renderCtx, boxes, frontIndex, rememberedMatches, W, H) {
  const matched = rememberedMatches?.matchedIndices || new Set();
  const nameByIndex = new Map(
    (rememberedMatches?.matches || []).map((m) => [
      m.index,
      m.profile.nickname,
    ]),
  );
  boxes.forEach((box, i) => {
    const [x1, y1, x2, y2] = clampBox(box, W, H);
    const isMatch = matched.has(i);
    const front = frontIndex === i;
    renderCtx.lineWidth = front || isMatch ? 4 : 2;
    renderCtx.strokeStyle = isMatch ? "#fff" : front ? "#ddd" : "#888";
    renderCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    drawNameLabel(renderCtx, [x1, y1, x2, y2], nameByIndex.get(i) || null);
  });
}

function renderSingle(maskList, W, H) {
  drawMirrored(ctxMain, W, H);
  drawMasks(ctxMain, maskList, W, H);
}

function renderCompare(maskList, W, H) {
  drawMirrored(ctxLeft, W, H);
  drawMirrored(ctxRight, W, H);
  drawMasks(ctxRight, maskList, W, H);
}

function renderRemember(boxes, frontIndex, rememberedMatches, W, H) {
  drawMirrored(ctxLearn, W, H);
  drawLearnBoxes(ctxLearn, boxes, frontIndex, rememberedMatches, W, H);
}

function faceArea([x1, y1, x2, y2]) {
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function frontmostIndex(boxes) {
  let best = -1;
  let bestArea = 0;
  boxes.forEach((box, i) => {
    const area = faceArea(box);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  return best;
}

function keepIndicesForMode(boxes, rememberedMatches) {
  if (targetMode === "remembered")
    return new Set(rememberedMatches.matchedIndices);
  const front = frontmostIndex(boxes);
  return front >= 0 ? new Set([front]) : new Set();
}

function collectLearningSample(embeddings, boxes, now, sourceCtx) {
  if (!learning || now - lastLearnSampleAt < 80) return;

  const idx = frontmostIndex(boxes);
  if (idx < 0 || !embeddings[idx]) {
    learnStatus.textContent = "NO FACE IN FRAME";
    return;
  }

  learnSamples.push(embeddings[idx]);
  if (!learnImage) learnImage = captureFaceImage(sourceCtx, boxes[idx]);
  lastLearnSampleAt = now;

  const pct = Math.round((learnSamples.length / LEARN_SAMPLES) * 100);
  learnProgress.style.width = `${pct}%`;
  learnStatus.textContent = `LEARNING ${learnSamples.length}/${LEARN_SAMPLES}`;

  if (learnSamples.length >= LEARN_SAMPLES) {
    const template = averageEmbeddings(learnSamples);
    const result = addFaceProfile(
      faceProfiles,
      template,
      learnSamples.length,
      learnImage,
    );
    faceProfiles = result.profiles;
    learning = false;
    learnSamples = [];
    learnImage = "";
    learnProgress.style.width = "100%";
    if (result.duplicate) {
      learnStatus.textContent = `${result.profile.nickname} ALREADY SAVED`;
    } else {
      learnStatus.textContent = result.profile
        ? `${result.profile.nickname} REMEMBERED`
        : "LEARN FAILED";
    }
    updateMemoryUi();
  }
}

// ── render loop ───────────────────────────────────────────────────────────────
function loop() {
  if (!running) return;
  if (video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }

  const now = performance.now();
  if ((++frameN, now - lastT >= 1000)) {
    sFps.textContent = Math.round((frameN * 1000) / (now - lastT));
    frameN = 0;
    lastT = now;
  }

  const W = video.videoWidth || 640,
    H = video.videoHeight || 480;
  syncCameraAspect(W, H);

  const res = landmarker.detectForVideo(video, now);
  const faces = res.faceLandmarks || [];
  const blends = res.faceBlendshapes || [];

  const boxes = faces.map((lms) => bboxMirrored(lms, W, H));
  const idMap = assignTracks(prevTracks, boxes);
  const newTracks = {};
  const emotions = [];

  boxes.forEach((box, i) => {
    const tid = idMap[i];
    newTracks[tid] = box;

    const blend = bsDict(blends[i]);
    const raw = emoScores(blend);

    if (!scoreEma[tid]) scoreEma[tid] = newEMA();
    applyEMA(scoreEma[tid], raw);

    const chosen = pickEmo(scoreEma[tid], emoState[tid]);
    emoState[tid] = chosen;
    emotions[i] = chosen;
  });

  drawMirrored(sampleCtx, W, H);
  const embeddings = faces.map((lms, i) =>
    faceEmbedding(lms, sampleCtx, boxes[i]),
  );
  const rememberedMatches = findRememberedFaces(
    embeddings,
    faceProfiles,
    MATCH_THRESHOLD,
  );
  const frontIndex = frontmostIndex(boxes);
  const keepIndices = keepIndicesForMode(boxes, rememberedMatches);
  const matchByIndex = new Map(
    rememberedMatches.matches.map((m) => [m.index, m.profile.nickname]),
  );
  const maskList = boxes.map((box, i) => ({
    box,
    emotion: emotions[i] || "neutral",
    masked: !keepIndices.has(i),
    nickname: matchByIndex.get(i) || null,
  }));

  collectLearningSample(embeddings, boxes, now, sampleCtx);

  const alive = new Set(Object.keys(newTracks).map(Number));
  for (const t of Object.keys(scoreEma).map(Number))
    if (!alive.has(t)) delete scoreEma[t];
  for (const t of Object.keys(emoState).map(Number))
    if (!alive.has(t)) delete emoState[t];
  prevTracks = newTracks;

  if (recording || currentPage === "single") renderSingle(maskList, W, H);
  else if (currentPage === "compare") renderCompare(maskList, W, H);
  else if (currentPage === "remember")
    renderRemember(boxes, frontIndex, rememberedMatches, W, H);

  sFaces.textContent = faces.length;
  if (recording) footStatus.textContent = "RECORDING";
  else if (learning) footStatus.textContent = "LEARNING FACE";
  else if (!faces.length) footStatus.textContent = "NO FACE DETECTED";
  else if (
    targetMode === "remembered" &&
    faceProfiles.length &&
    rememberedMatches.matches.length
  )
    footStatus.textContent = "REMEMBERED FACE VISIBLE";
  else if (targetMode === "remembered" && faceProfiles.length)
    footStatus.textContent = "REMEMBERED FACE NOT FOUND";
  else if (targetMode === "remembered")
    footStatus.textContent = "NO FACE MEMORY";
  else footStatus.textContent = "FRONT FACE VISIBLE";

  updateMemoryUi(rememberedMatches, false);
  requestAnimationFrame(loop);
}

function cameraUnavailableMessage() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(
    location.hostname,
  );
  if (!window.isSecureContext && !localHost) return "USE HTTPS OR LOCALHOST";
  return "CAMERA API NOT AVAILABLE";
}

function getCameraStream() {
  const videoOnly = {
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: "user",
    },
  };
  const withAudio = {
    ...videoOnly,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };

  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices
      .getUserMedia(withAudio)
      .catch(() => navigator.mediaDevices.getUserMedia(videoOnly));
  }

  const legacyGetUserMedia =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;

  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, withAudio, resolve, () => {
        legacyGetUserMedia.call(navigator, videoOnly, resolve, reject);
      });
    });
  }

  throw new Error(cameraUnavailableMessage());
}

function cameraErrorText(err) {
  if (
    err?.name === "NotAllowedError" ||
    err?.name === "PermissionDeniedError"
  ) {
    return "CAMERA PERMISSION DENIED";
  }
  if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
    return "NO CAMERA FOUND";
  }
  if (err?.name === "NotReadableError" || err?.name === "TrackStartError") {
    return "CAMERA ALREADY IN USE";
  }
  if (err?.name === "SecurityError") {
    return "USE HTTPS OR LOCALHOST";
  }
  return String(err?.message || err || "CAMERA START FAILED");
}

// ── start button ──────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  if (!landmarker) return;
  try {
    const stream = await getCameraStream();
    video.srcObject = stream;
    await video.play();

    overlay.classList.add("hidden");
    recLabel.textContent = "REC";
    compareTab.disabled = false;
    rememberTab.disabled = false;
    running = true;
    lastT = performance.now();
    updateMemoryUi();
    updateRecordUi();
    learnStatus.textContent = faceProfiles.length
      ? "MEMORY READY"
      : "NO MEMORY";
    requestAnimationFrame(loop);
    footStatus.textContent = "RUNNING";
  } catch (e) {
    const message = cameraErrorText(e);
    initMsg.textContent = "CAM ERR: " + message.slice(0, 48);
    footStatus.textContent = message;
  }
});
