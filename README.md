## Features

- Detects up to 6 faces simultaneously
- Overlays emotion emoji per face (smile, laughing, shocked, angry, thinking, neutral)
- **Single view** — full-screen emoji overlay
- **Compare view** — raw feed vs. emoji overlay side by side
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

## Dependencies

All loaded via CDN — no install required.

| Library | Source |
|---|---|
| MediaPipe Tasks Vision | jsdelivr CDN |
| Press Start 2P (font) | Google Fonts |
