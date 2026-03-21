import { FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

import {
  MODEL_LOCAL, MODEL_CDN, WASM_CDN,
  ASSET_BASE, EMOJI_FILES,
  MAX_FACES, MIN_DETECT, MIN_BOX,
} from "./config.js";

import { bsDict, emoScores, applyEMA, newEMA, pickEmo } from "./emotion.js";
import { bboxMirrored, assignTracks } from "./tracker.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video       = document.getElementById("webcam");
const overlay     = document.getElementById("overlay");
const startBtn    = document.getElementById("start-btn");
const initMsg     = document.getElementById("init-msg");
const recLabel    = document.getElementById("rec-label");
const sFaces      = document.getElementById("s-faces");
const sFps        = document.getElementById("s-fps");
const footStatus  = document.getElementById("footer-status");

// canvases
const canvasMain  = document.getElementById("canvas-main");
const ctxMain     = canvasMain.getContext("2d");
const canvasLeft  = document.getElementById("canvas-left");
const ctxLeft     = canvasLeft.getContext("2d");
const canvasRight = document.getElementById("canvas-right");
const ctxRight    = canvasRight.getContext("2d");

// nav
const navBtns    = document.querySelectorAll(".nav-btn");
const compareTab = document.getElementById("compare-tab");
const pages      = document.querySelectorAll(".page");

// ── page switching ────────────────────────────────────────────────────────────
let currentPage = "single";

navBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    currentPage = btn.dataset.page;
    navBtns.forEach(b => b.classList.toggle("active", b === btn));
    pages.forEach(p => p.classList.toggle("active", p.id === `page-${currentPage}`));
  });
});

// ── load emoji images ─────────────────────────────────────────────────────────
const imgs = {};
await Promise.all(Object.entries(EMOJI_FILES).map(([k, f]) =>
  new Promise(res => {
    const img = new Image();
    img.onload = () => { imgs[k] = img; res(); };
    img.onerror = res;
    img.src = ASSET_BASE + f;
  })
));

// ── init mediapipe ────────────────────────────────────────────────────────────
let landmarker;
try {
  const wasm = await FilesetResolver.forVisionTasks(WASM_CDN);

  let modelPath = MODEL_LOCAL;
  try {
    const probe = await fetch(MODEL_LOCAL, { method: "HEAD" });
    if (!probe.ok) modelPath = MODEL_CDN;
  } catch { modelPath = MODEL_CDN; }

  landmarker = await FaceLandmarker.createFromOptions(wasm, {
    baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: MAX_FACES,
    minFaceDetectionConfidence: MIN_DETECT,
    minFacePresenceConfidence:  MIN_DETECT,
    minTrackingConfidence:      MIN_DETECT,
    outputFaceBlendshapes: true,
  });

  initMsg.textContent = "MODEL READY — CLICK TO START";
  startBtn.disabled = false;
} catch (err) {
  initMsg.textContent = "ERR: " + String(err.message).slice(0, 48);
  recLabel.textContent = "ERROR";
}

// ── render helpers ────────────────────────────────────────────────────────────
function drawMirrored(renderCtx, W, H) {
  renderCtx.canvas.width  = W;
  renderCtx.canvas.height = H;
  renderCtx.save();
  renderCtx.scale(-1, 1);
  renderCtx.drawImage(video, -W, 0);
  renderCtx.restore();
}

function drawEmojis(renderCtx, drawList) {
  drawList.forEach(({ box, emotion }) => {
    const [x1, y1, x2, y2] = box;
    const tw = x2 - x1, th = y2 - y1;
    if (tw >= MIN_BOX && th >= MIN_BOX && imgs[emotion])
      renderCtx.drawImage(imgs[emotion], x1, y1, tw, th);
  });
}

function renderSingle(drawList, W, H) {
  drawMirrored(ctxMain, W, H);
  drawEmojis(ctxMain, drawList);
}

function renderCompare(drawList, W, H) {
  drawMirrored(ctxLeft,  W, H);           // clean
  drawMirrored(ctxRight, W, H);           // + emoji
  drawEmojis(ctxRight, drawList);
}

// ── tracking state ────────────────────────────────────────────────────────────
let scoreEma = {}, emoState = {}, prevTracks = {};
let running = false, lastT = 0, frameN = 0;

// ── render loop ───────────────────────────────────────────────────────────────
function loop() {
  if (!running) return;

  // fps counter
  const now = performance.now();
  if (++frameN, now - lastT >= 1000) {
    sFps.textContent = Math.round(frameN * 1000 / (now - lastT));
    frameN = 0; lastT = now;
  }

  const W = video.videoWidth || 640, H = video.videoHeight || 480;

  // detect
  const res    = landmarker.detectForVideo(video, performance.now());
  const faces  = res.faceLandmarks   || [];
  const blends = res.faceBlendshapes || [];

  // process tracks + emotions, build draw list
  const boxes     = faces.map(lms => bboxMirrored(lms, W, H));
  const idMap     = assignTracks(prevTracks, boxes);
  const newTracks = {};
  const drawList  = [];

  boxes.forEach((box, i) => {
    const tid = idMap[i];
    newTracks[tid] = box;

    if (!scoreEma[tid]) scoreEma[tid] = newEMA();
    applyEMA(scoreEma[tid], emoScores(bsDict(blends[i])));

    const chosen = pickEmo(scoreEma[tid], emoState[tid]);
    emoState[tid] = chosen;
    drawList.push({ box, emotion: chosen });
  });

  // prune disappeared faces
  const alive = new Set(Object.keys(newTracks).map(Number));
  for (const t of Object.keys(scoreEma).map(Number)) if (!alive.has(t)) delete scoreEma[t];
  for (const t of Object.keys(emoState).map(Number))  if (!alive.has(t)) delete emoState[t];
  prevTracks = newTracks;

  // render to active page
  if (currentPage === "single") renderSingle(drawList, W, H);
  else                          renderCompare(drawList, W, H);

  // stats
  sFaces.textContent = faces.length;
  footStatus.textContent = faces.length > 0 ? "RUNNING" : "NO FACE DETECTED";

  requestAnimationFrame(loop);
}

// ── start button ──────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  if (!landmarker) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = r; });

    overlay.classList.add("hidden");
    recLabel.textContent = "REC";
    compareTab.disabled = false;      // unlock compare tab once camera is live
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
    footStatus.textContent = "RUNNING";
  } catch (e) {
    initMsg.textContent = "CAM ERR: " + String(e.message).slice(0, 32);
  }
});
