# ✋ Air Draw — Gesture-Based Doodler

> Draw in the air using just your hand gestures, powered by real-time computer vision.

**Created by Akshat Tiwari**

## 🌐 Live Demo

👉 **[Try Air Draw Now!](https://akshat17tiwari.github.io/AirDraw/)**

---

## 🎮 How It Works

Air Draw uses your webcam and **MediaPipe Hand Landmarker** to track your hand in real time. Different hand gestures map to different actions:

| Gesture | Action |
|---------|--------|
| ☝️ Point index finger | **Draw** — creates neon glow strokes |
| ✋ Open palm | **Erase** — sweep to remove strokes |
| 🤏 Pinch | **Grab & Move** — reposition strokes |
| ✊ Closed fist | **Idle** — rest without drawing |

## ✨ Features

- 🎨 **8-color palette** with glassmorphic swatch selector
- 🖌️ **Adjustable brush thickness & glow intensity**
- ↩️ **Undo / Clear** canvas controls
- 📷 **Camera toggle** — ON → DIM → Dark Canvas modes
- 💾 **Save** drawings as PNG
- ✨ **Particle effects** while drawing
- 🔊 **Audio feedback** on gesture transitions
- 🦴 **Hand skeleton overlay** visualization
- 📱 **Fully responsive** — mobile bottom toolbar layout

## 🛠️ Tech Stack

- **MediaPipe Tasks Vision** — Hand landmark detection
- **HTML5 Canvas** — Triple-layer rendering (camera, drawing, UI)
- **Web Audio API** — Gesture sound effects
- **Vanilla JS / CSS** — No frameworks, pure web technologies

## 🚀 Getting Started

1. Open `index.html` in a browser (or serve with a local server)
2. Allow camera access when prompted
3. Start drawing with your hand!

```bash
# Serve locally
npx serve .
```

## 📁 Project Structure

```
gesture draw/
├── index.html    → Page structure & layout
├── style.css     → Glassmorphism dark theme & responsive styles
├── main.js       → Hand tracking, gestures, drawing engine
└── README.md     → This file
```

---

Made with 🤟 by **Akshat Tiwari**
