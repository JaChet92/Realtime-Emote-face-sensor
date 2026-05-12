## Features

- Detects up to 6 faces simultaneously
- Keeps the frontmost face visible and masks other faces with emotion emoji by default
- Switchable privacy target: frontmost face or saved face profiles
- Switchable mask style: emoji or blur
- Runtime-generated emoji stages for sad, sleepy, and confused
- Record the privacy feed from the Single view
- **Single view** — privacy-masked camera feed
- **Preview view** — stored recordings with playback, export, and clear controls
- **Compare view** — raw feed vs. privacy feed side by side
- **Remember view** — learn many face profiles with thumbnails and editable nicknames
- EMA smoothing + hysteresis to prevent jitter

## Project Structure

```
/
├── index.html              # markup
├── style.css               # styles (8-bit pixel theme)
├── assets/                 # emoji images
│   ├── smile.png
│   ├── Laughing.png
│   ├── shocked.png
│   ├── Angry.jpeg
│   ├── Thinking.webp
│   └── Neutral.png
└── js/
    ├── config.js           # paths, constants, tuning params
    ├── emotion.js          # emotion scoring logic  (pure, no DOM)
    ├── generatedEmoji.js   # runtime canvas emoji assets
    ├── recordings.js       # IndexedDB video recording storage
    ├── recognition.js      # lightweight local face memory
    ├── tracker.js          # face tracking / bbox   (pure, no DOM)
    └── main.js             # camera, render loop, UI
```

> The model file (`face_landmarker.task`, ~30 MB) is excluded from the repo.
> The app falls back to the MediaPipe CDN automatically — no extra setup needed.
> To use a local model, drop `face_landmarker.task` into the repo root.

## Running Locally

Must be served over HTTP (MediaPipe requires `fetch` for WASM):

```bash
# from the repo root
python3 -m http.server 8080
```

Then open: `http://localhost:8080/`

## Face Memory

Face profiles are stored in browser `localStorage`. Each saved profile gets a thumbnail and a default nickname like `usr1`, `usr2`, etc. Learning the same face again reuses the existing profile instead of creating a duplicate; this duplicate check uses a stricter threshold than live matching so different people can still be saved as separate profiles. The matcher uses a lightweight signature from MediaPipe landmarks plus a tiny normalized face crop, so it is useful for this camera effect but is not a security-grade identity check.

## Recordings

Recorded clips are stored in browser IndexedDB as MP4 when the browser supports MP4 `MediaRecorder`, otherwise WebM. They include microphone audio when permission is granted, stay local to the browser, and can be exported from the Preview tab.

## Dependencies

All loaded via CDN — no install required.

| Library | Source |
|---|---|
| MediaPipe Tasks Vision | jsdelivr CDN |
| Press Start 2P (font) | Google Fonts |
