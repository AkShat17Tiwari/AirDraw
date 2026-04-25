// ─── Air Draw — Gesture-Based Doodler ───
// Uses MediaPipe Hand Landmarker for real-time hand tracking

// ─── State ───
const state = {
  handLandmarker: null, webcamStream: null, isReady: false,
  strokes: [], currentStroke: null,
  activeColor: "#00f0ff", thickness: 6, glowIntensity: 60,
  currentGesture: "idle", previousGesture: "idle",
  gestureStableFrames: 0, gestureStartTime: 0,
  isModalOpen: true, isGrabbing: false,
  grabStartPos: null, grabOffset: { x: 0, y: 0 },
  nearestStrokeIdx: -1, eraserRadius: 28,
  showCamera: true, cameraOpacity: 0.35,
  particles: [], smoothPos: { x: 0, y: 0 }, smoothFactor: 0.35,
  width: 0, height: 0, audioCtx: null,
};

// ─── DOM References ───
const $ = (id) => document.getElementById(id);
const loadingScreen = $("loading-screen");
const appEl = $("app");
const video = $("webcam");
const camCanvas = $("camera-canvas");
const drawCanvas = $("drawing-canvas");
const uiCanvas = $("ui-canvas");
const camCtx = camCanvas.getContext("2d");
const drawCtx = drawCanvas.getContext("2d");
const uiCtx = uiCanvas.getContext("2d");
const gestureHud = $("gesture-hud");
const gestureIcon = $("gesture-icon");
const gestureLabel = $("gesture-label");
const thicknessSlider = $("thickness-slider");
const thicknessValue = $("thickness-value");
const glowSlider = $("glow-slider");
const glowValue = $("glow-value");
const camModeText = $("camera-mode-text");
const camModeIndicator = $("camera-mode-indicator");
const modal = $("onboarding-modal");
const btnStart = $("btn-start");
const colorPalette = $("color-palette");
const colorPickerToggle = $("color-picker-toggle");
const activeColorPreview = $("active-color-preview");

// ─── Audio Helpers ───
function getAudioCtx() {
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return state.audioCtx;
}
function playTone(freq, dur, type = "sine", vol = 0.06) {
  try {
    const ctx = getAudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + dur);
  } catch (e) { /* ignore audio errors */ }
}

// ─── Canvas Sizing ───
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  state.width = w; state.height = h;
  [camCanvas, drawCanvas, uiCanvas].forEach((c) => { c.width = w; c.height = h; });
}
window.addEventListener("resize", () => { resize(); redraw(); });

// ─── MediaPipe Initialization ───
async function initHandTracking() {
  const { FilesetResolver, HandLandmarker } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs"
  );
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
  );
  state.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO", numHands: 1,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
  });
  return true;
}

async function initWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
  });
  video.srcObject = stream; state.webcamStream = stream;
  return new Promise((res) => { video.onloadedmetadata = () => { video.play(); res(); }; });
}

// ─── Gesture Detection ───
function detectGesture(landmarks) {
  if (!landmarks || landmarks.length === 0) return "none";
  const lm = landmarks;
  const thumbTip = lm[4], thumbIP = lm[3], indexTip = lm[8], indexPIP = lm[6];
  const middleTip = lm[12], middlePIP = lm[10];
  const ringTip = lm[16], ringPIP = lm[14];
  const pinkyTip = lm[20], pinkyPIP = lm[18];

  const indexUp = indexTip.y < indexPIP.y - 0.02;
  const middleDown = middleTip.y > middlePIP.y;
  const ringDown = ringTip.y > ringPIP.y;
  const pinkyDown = pinkyTip.y > pinkyPIP.y;
  const middleUp = middleTip.y < middlePIP.y;
  const ringUp = ringTip.y < ringPIP.y;
  const pinkyUp = pinkyTip.y < pinkyPIP.y;
  const thumbOut = Math.abs(thumbTip.x - thumbIP.x) > 0.03 || thumbTip.y < thumbIP.y;

  const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  if (pinchDist < 0.06 && !middleUp && !ringUp && !pinkyUp) return "pinch";
  if (indexUp && middleUp && ringUp && pinkyUp && thumbOut) return "open_palm";
  if (indexUp && middleDown && ringDown && pinkyDown) return "index_finger";
  if (!indexUp && !middleUp && !ringUp && !pinkyUp) return "fist";
  return "idle";
}

function stabilizeGesture(raw) {
  if (raw === state.currentGesture) {
    state.previousGesture = raw; state.gestureStableFrames = 0;
    return state.currentGesture;
  }
  if (raw === state.previousGesture) state.gestureStableFrames++;
  else { state.previousGesture = raw; state.gestureStableFrames = 1; }

  const threshold = raw === "pinch" ? 3 : 4;
  if (state.gestureStableFrames >= threshold) {
    const prev = state.currentGesture;
    state.currentGesture = raw; state.gestureStableFrames = 0;
    state.gestureStartTime = Date.now();
    if (prev !== raw) onGestureChange(prev, raw);
    return raw;
  }
  return state.currentGesture;
}

function onGestureChange(from, to) {
  if (to === "index_finger") playTone(880, 0.08, "sine", 0.04);
  else if (to === "open_palm") playTone(1200, 0.05, "sine", 0.03);
  else if (to === "pinch") playTone(660, 0.1, "sine", 0.05);
  else if (from === "index_finger") playTone(440, 0.1, "sine", 0.03);

  if (from === "index_finger" && state.currentStroke) {
    if (state.currentStroke.points.length > 1) state.strokes.push({ ...state.currentStroke });
    state.currentStroke = null;
  }
  if (from === "pinch") endGrab();
  updateHUD(to);
}

function updateHUD(gesture) {
  const map = {
    index_finger: { icon: "☝️", label: "Drawing", cls: "drawing" },
    open_palm: { icon: "✋", label: "Erasing", cls: "erasing" },
    pinch: { icon: "🤏", label: "Grab", cls: "grabbing" },
    fist: { icon: "✊", label: "Idle", cls: "" },
    idle: { icon: "🖐️", label: "Ready", cls: "" },
    none: { icon: "👋", label: "Show hand", cls: "" },
  };
  const info = map[gesture] || map.idle;
  gestureIcon.textContent = info.icon;
  gestureLabel.textContent = info.label;
  gestureHud.className = info.cls;
}

// ─── Coordinate Helpers ───
function landmarkToScreen(lm) {
  return { x: (1 - lm.x) * state.width, y: lm.y * state.height };
}
function smooth(pos) {
  state.smoothPos.x += (pos.x - state.smoothPos.x) * state.smoothFactor;
  state.smoothPos.y += (pos.y - state.smoothPos.y) * state.smoothFactor;
  return { x: state.smoothPos.x, y: state.smoothPos.y };
}

// ─── Drawing ───
function handleDraw(landmarks) {
  const tip = landmarks[8], screen = landmarkToScreen(tip), pos = smooth(screen);
  if (Date.now() - state.gestureStartTime < 300) { state.smoothPos = { ...screen }; return; }
  if (state.currentStroke) {
    state.currentStroke.points.push({ ...pos });
  } else {
    state.currentStroke = {
      points: [pos], color: state.activeColor,
      thickness: state.thickness, glow: state.glowIntensity,
    };
    state.smoothPos = { ...screen };
  }
  spawnParticles(pos.x, pos.y, state.activeColor);
  redraw();
}

// ─── Erasing ───
function handleErase(landmarks) {
  const wrist = landmarks[0], mid = landmarks[9];
  const center = { x: (1 - (wrist.x + mid.x) / 2) * state.width, y: ((wrist.y + mid.y) / 2) * state.height };
  const r = state.eraserRadius;
  let erased = false;
  const kept = [];
  for (const stroke of state.strokes) {
    const segments = []; let seg = [];
    for (const pt of stroke.points) {
      if (Math.hypot(pt.x - center.x, pt.y - center.y) >= r) { seg.push(pt); }
      else { erased = true; if (seg.length >= 2) segments.push(seg); seg = []; }
    }
    if (seg.length >= 2) segments.push(seg);
    if (segments.length === 0 && stroke.points.length > 0) continue;
    if (segments.length === 1 && segments[0].length === stroke.points.length) { kept.push(stroke); continue; }
    for (const s of segments) kept.push({ points: s, color: stroke.color, thickness: stroke.thickness, glow: stroke.glow });
  }
  state.strokes = kept;
  if (erased) playTone(200, 0.06, "triangle", 0.03);

  // Draw eraser indicator
  uiCtx.beginPath(); uiCtx.arc(center.x, center.y, r, 0, Math.PI * 2);
  uiCtx.strokeStyle = "rgba(255, 45, 107, 0.5)"; uiCtx.lineWidth = 1.5;
  uiCtx.setLineDash([5, 5]); uiCtx.stroke(); uiCtx.setLineDash([]);
  uiCtx.fillStyle = "rgba(255, 45, 107, 0.05)"; uiCtx.fill();
  redraw();
}

// ─── Grab / Move ───
function handleGrab(landmarks) {
  const thumb = landmarks[4], index = landmarks[8];
  const pos = { x: (1 - (thumb.x + index.x) / 2) * state.width, y: ((thumb.y + index.y) / 2) * state.height };
  if (!state.isGrabbing) {
    state.isGrabbing = true; state.grabStartPos = { ...pos };
    state.nearestStrokeIdx = findNearestStroke(pos);
  } else {
    const dx = pos.x - state.grabStartPos.x, dy = pos.y - state.grabStartPos.y;
    if (state.nearestStrokeIdx >= 0 && state.nearestStrokeIdx < state.strokes.length) {
      const stroke = state.strokes[state.nearestStrokeIdx];
      const ddx = dx - state.grabOffset.x, ddy = dy - state.grabOffset.y;
      for (const pt of stroke.points) { pt.x += ddx; pt.y += ddy; }
    }
    state.grabOffset = { x: dx, y: dy };
  }
  // Draw grab indicator
  uiCtx.beginPath(); uiCtx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
  uiCtx.strokeStyle = "rgba(255, 215, 0, 0.7)"; uiCtx.lineWidth = 2; uiCtx.stroke();
  uiCtx.fillStyle = "rgba(255, 215, 0, 0.1)"; uiCtx.fill();
  if (state.nearestStrokeIdx >= 0 && state.nearestStrokeIdx < state.strokes.length)
    drawHighlight(state.strokes[state.nearestStrokeIdx]);
  redraw();
}

function endGrab() {
  if (state.isGrabbing && state.nearestStrokeIdx >= 0) playTone(330, 0.15, "sine", 0.04);
  state.isGrabbing = false; state.grabStartPos = null;
  state.grabOffset = { x: 0, y: 0 }; state.nearestStrokeIdx = -1;
  redraw();
}

function findNearestStroke(pos) {
  let minDist = Infinity, idx = -1;
  for (let i = 0; i < state.strokes.length; i++) {
    for (const pt of state.strokes[i].points) {
      const d = Math.hypot(pt.x - pos.x, pt.y - pos.y);
      if (d < minDist) { minDist = d; idx = i; }
    }
  }
  return minDist < 80 ? idx : -1;
}

function drawHighlight(stroke) {
  if (!stroke || stroke.points.length < 2) return;
  uiCtx.save(); uiCtx.beginPath();
  uiCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) uiCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
  uiCtx.strokeStyle = "rgba(255, 215, 0, 0.3)"; uiCtx.lineWidth = stroke.thickness + 12;
  uiCtx.lineCap = "round"; uiCtx.lineJoin = "round";
  uiCtx.setLineDash([8, 8]); uiCtx.stroke(); uiCtx.setLineDash([]);
  uiCtx.restore();
}

// ─── Stroke Rendering ───
function lightenColor(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * amount))}, ${Math.min(255, Math.round(g + (255 - g) * amount))}, ${Math.min(255, Math.round(b + (255 - b) * amount))})`;
}

function drawStroke(ctx, stroke) {
  if (!stroke || stroke.points.length < 2) return;
  const pts = stroke.points, color = stroke.color, thick = stroke.thickness, glow = stroke.glow / 100;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";

  const drawPath = () => {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + c.x) / 2, (p.y + c.y) / 2);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };

  if (glow > 0) {
    drawPath(); ctx.strokeStyle = color; ctx.lineWidth = thick * 3;
    ctx.globalAlpha = 0.1 * glow; ctx.shadowColor = color; ctx.shadowBlur = 35 * glow; ctx.stroke();
    drawPath(); ctx.strokeStyle = color; ctx.lineWidth = thick * 1.6;
    ctx.globalAlpha = 0.35 * glow; ctx.shadowBlur = 15 * glow; ctx.stroke();
  }
  drawPath(); ctx.strokeStyle = lightenColor(color, 0.5); ctx.lineWidth = thick;
  ctx.globalAlpha = 1; ctx.shadowBlur = 6 * glow; ctx.shadowColor = color; ctx.stroke();
  ctx.restore();
}

function redraw() {
  drawCtx.clearRect(0, 0, state.width, state.height);
  for (const s of state.strokes) drawStroke(drawCtx, s);
  if (state.currentStroke && state.currentStroke.points.length > 1) drawStroke(drawCtx, state.currentStroke);
}

// ─── Particles ───
function spawnParticles(x, y, color) {
  for (let i = 0; i < 2; i++) {
    state.particles.push({
      x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
      life: 1, decay: 0.02 + Math.random() * 0.03, size: 2 + Math.random() * 3, color,
    });
  }
}

function renderParticles(ctx) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= p.decay; p.size *= 0.97;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }
    ctx.save(); ctx.globalAlpha = p.life * 0.7; ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

// ─── Hand Skeleton ───
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];

function drawSkeleton(ctx, lm) {
  if (!lm) return;
  ctx.save(); ctx.globalAlpha = 0.3;
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarkToScreen(lm[a]), pb = landmarkToScreen(lm[b]);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    const p = landmarkToScreen(lm[i]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
  }
  for (const tip of [4, 8, 12, 16, 20]) {
    const p = landmarkToScreen(lm[tip]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 10;
    ctx.fill(); ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawCursor(ctx, lm, gesture) {
  if (gesture !== "index_finger") return;
  const p = landmarkToScreen(lm[8]);
  ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, state.thickness / 2 + 6, 0, Math.PI * 2);
  ctx.strokeStyle = state.activeColor; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.shadowColor = state.activeColor; ctx.shadowBlur = 8; ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = state.activeColor; ctx.globalAlpha = 0.9; ctx.fill(); ctx.restore();
}

// ─── Main Loop ───
let lastVideoTime = -1;
function loop() {
  if (!state.handLandmarker || !state.isReady) { requestAnimationFrame(loop); return; }
  const now = performance.now();

  camCtx.clearRect(0, 0, state.width, state.height);
  if (state.showCamera) {
    camCtx.save(); camCtx.globalAlpha = state.cameraOpacity;
    camCtx.translate(state.width, 0); camCtx.scale(-1, 1);
    camCtx.drawImage(video, 0, 0, state.width, state.height); camCtx.restore();
  }

  uiCtx.clearRect(0, 0, state.width, state.height);

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = state.handLandmarker.detectForVideo(video, now);
    if (results.landmarks && results.landmarks.length > 0) {
      const lm = results.landmarks[0];
      const raw = detectGesture(lm), gesture = stabilizeGesture(raw);
      if (!state.isModalOpen) {
        if (gesture === "index_finger") handleDraw(lm);
        if (gesture === "open_palm") handleErase(lm);
        if (gesture === "pinch") handleGrab(lm);
        if (gesture !== "index_finger" && state.currentStroke && state.currentStroke.points.length > 1) {
          state.strokes.push({ ...state.currentStroke }); state.currentStroke = null;
        }
      }
      drawSkeleton(uiCtx, lm); drawCursor(uiCtx, lm, gesture);
    } else {
      if (state.currentGesture !== "none") { onGestureChange(state.currentGesture, "none"); state.currentGesture = "none"; }
      if (state.currentStroke && state.currentStroke.points.length > 1) {
        state.strokes.push({ ...state.currentStroke }); state.currentStroke = null; redraw();
      }
    }
  }
  renderParticles(uiCtx);
  requestAnimationFrame(loop);
}

// ─── UI Event Listeners ───
function updateActivePreview(color) {
  activeColorPreview.style.setProperty("--swatch-color", color);
  activeColorPreview.dataset.color = color;
}

document.querySelectorAll("#color-palette .color-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    document.querySelectorAll("#color-palette .color-swatch").forEach((s) => s.classList.remove("active"));
    swatch.classList.add("active");
    state.activeColor = swatch.dataset.color;
    updateActivePreview(swatch.dataset.color);
    playTone(1000, 0.05, "sine", 0.03);
    colorPalette.classList.remove("mobile-open");
  });
});

colorPickerToggle.addEventListener("click", () => colorPalette.classList.toggle("mobile-open"));
document.addEventListener("pointerdown", (e) => {
  if (!colorPalette.contains(e.target) && !colorPickerToggle.contains(e.target))
    colorPalette.classList.remove("mobile-open");
});

thicknessSlider.addEventListener("input", () => {
  state.thickness = parseInt(thicknessSlider.value);
  thicknessValue.textContent = `${state.thickness}px`;
});

glowSlider.addEventListener("input", () => {
  state.glowIntensity = parseInt(glowSlider.value);
  glowValue.textContent = `${state.glowIntensity}%`;
});

$("btn-undo").addEventListener("click", () => {
  if (state.strokes.length > 0) { state.strokes.pop(); redraw(); playTone(500, 0.08, "sine", 0.03); }
});

$("btn-clear").addEventListener("click", () => {
  state.strokes = []; state.currentStroke = null; state.particles = [];
  redraw(); playTone(300, 0.15, "triangle", 0.04);
});

$("btn-camera-toggle").addEventListener("click", () => {
  if (state.showCamera && state.cameraOpacity > 0.2) {
    state.cameraOpacity = 0.15; camModeText.textContent = "Camera DIM";
    camModeIndicator.classList.remove("dark-mode");
  } else if (state.showCamera && state.cameraOpacity <= 0.2) {
    state.showCamera = false; state.cameraOpacity = 0; camModeText.textContent = "Dark Canvas";
    camModeIndicator.classList.add("dark-mode");
    $("btn-camera-toggle").classList.remove("active");
  } else {
    state.showCamera = true; state.cameraOpacity = 0.35; camModeText.textContent = "Camera ON";
    camModeIndicator.classList.remove("dark-mode");
    $("btn-camera-toggle").classList.add("active");
  }
  playTone(1200, 0.05, "sine", 0.03);
});

camModeIndicator.addEventListener("click", () => $("btn-camera-toggle").click());

$("btn-save").addEventListener("click", () => {
  const tmp = document.createElement("canvas");
  tmp.width = state.width; tmp.height = state.height;
  const ctx = tmp.getContext("2d");
  ctx.fillStyle = "#07070d"; ctx.fillRect(0, 0, state.width, state.height);
  ctx.drawImage(drawCanvas, 0, 0);
  const a = document.createElement("a");
  a.download = `air-draw-${Date.now()}.png`; a.href = tmp.toDataURL("image/png"); a.click();
  playTone(800, 0.1, "sine", 0.04);
});

btnStart.addEventListener("click", () => {
  modal.classList.add("hidden"); state.isModalOpen = false;
  playTone(800, 0.1, "sine", 0.04); updateHUD("idle");
});

// ─── Bootstrap ───
async function init() {
  resize();
  try {
    await Promise.all([initHandTracking(), initWebcam()]);
    state.isReady = true;
    const bar = document.querySelector(".loader-bar-fill");
    bar.style.animation = "none"; bar.style.width = "100%"; bar.style.transition = "width 0.4s ease";
    setTimeout(() => { loadingScreen.classList.add("fade-out"); appEl.classList.remove("hidden"); modal.classList.remove("hidden"); }, 600);
    setTimeout(() => { loadingScreen.style.display = "none"; }, 1200);
    loop();
  } catch (err) {
    console.error("Failed to initialize Air Draw:", err);
    document.querySelector(".loader-subtitle").textContent = "Error: Camera access required. Please allow camera permissions and reload.";
    document.querySelector(".loader-subtitle").style.color = "#ff2d6b";
    document.querySelector(".loader-bar").style.display = "none";
  }
}
init();
