const SIZE = 256;

function canvasEmoji(draw) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#ffd43b";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  draw(ctx);
  return canvas;
}

function eye(ctx, x, y, w = 18, h = 30) {
  ctx.fillStyle = "#000";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

function line(ctx, points, width = 10) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = width;
  ctx.lineCap = "square";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function mouthArc(ctx, y, flip = 1) {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(128, y, 44, flip > 0 ? 0.1 * Math.PI : 1.1 * Math.PI, flip > 0 ? 0.9 * Math.PI : 1.9 * Math.PI);
  ctx.stroke();
}

const drawings = {
  sad: ctx => {
    line(ctx, [[72, 86], [106, 102]], 9);
    line(ctx, [[184, 86], [150, 102]], 9);
    eye(ctx, 88, 126, 18, 24);
    eye(ctx, 168, 126, 18, 24);
    mouthArc(ctx, 190, -1);
    ctx.fillStyle = "#6ec6ff";
    ctx.fillRect(176, 142, 16, 42);
  },

  sleepy: ctx => {
    line(ctx, [[68, 116], [106, 116]], 10);
    line(ctx, [[150, 116], [188, 116]], 10);
    line(ctx, [[98, 176], [158, 176]], 10);
    ctx.fillStyle = "#000";
    ctx.font = "bold 38px monospace";
    ctx.fillText("Z", 168, 78);
    ctx.fillText("z", 195, 45);
  },

  confused: ctx => {
    line(ctx, [[66, 88], [108, 76]], 9);
    line(ctx, [[150, 76], [190, 94]], 9);
    eye(ctx, 88, 126, 18, 26);
    eye(ctx, 168, 126, 18, 26);
    line(ctx, [[96, 176], [126, 166], [160, 176]], 10);
    ctx.fillStyle = "#000";
    ctx.font = "bold 34px monospace";
    ctx.fillText("?", 184, 76);
  },
};

export function createGeneratedEmoji(emotion) {
  const draw = drawings[emotion];
  return draw ? canvasEmoji(draw) : null;
}
