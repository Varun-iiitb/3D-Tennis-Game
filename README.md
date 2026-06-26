# Gesture Tennis 🎾

A Wii Sports–style 3D tennis game played **entirely with hand gestures** through
your webcam. There is no keyboard, mouse, or controller — you physically swing
your arm in front of the camera and MediaPipe Hands reads the motion to drive
forehands, backhands, and overhead smashes.

> The actual project lives in the [`gesture-tennis/`](gesture-tennis/) subfolder.
> This file describes the whole repository; build/run commands are run from inside
> that folder.

---

## Gameplay

- A neon ball is served toward you across a dark night court.
- When the ball reaches your hittable zone, **swing your hand**:
  - **Left → right** = forehand
  - **Right → left** = backhand
  - **Sharp downward from above** = smash / overhead
- Swing speed controls shot power (watch the on-screen power meter).
- A box-silhouette AI opponent returns the ball; it gets faster and more
  accurate the longer the rally goes.
- Full tennis scoring is simulated: **points → games → sets → match**
  (0/15/30/40, deuce/advantage, first to 6 games win-by-2, tiebreak at 6–6,
  best of 3 sets).
- On the game-over screen, **hold an open palm for 2 seconds** to restart.

---

## Tech stack

| Concern            | Choice                                   |
|--------------------|------------------------------------------|
| Build tool / dev server | [Vite](https://vitejs.dev) (v8)     |
| Language           | Vanilla JavaScript (ES modules) — no React, no TypeScript |
| 3D rendering       | [Three.js](https://threejs.org) (v0.184) |
| Hand tracking      | [MediaPipe Hands](https://developers.google.com/mediapipe) |
| Audio              | Web Audio API (fully procedural — no audio files) |
| Gesture overlay    | Plain Canvas 2D                          |
| Font               | Orbitron (Google Fonts)                  |

MediaPipe is loaded as legacy IIFE bundles via `<script>` tags from a CDN in
[`index.html`](gesture-tennis/index.html) (it registers `Hands`, `Camera`,
`drawConnectors`, etc. on `window`). The npm `@mediapipe/*` packages are present
mainly to pin versions; the runtime globals come from the CDN scripts.

---

## Prerequisites

- **Node.js 18+** and npm.
- A **webcam**.
- A modern browser with WebGL and `getUserMedia` support (Chrome/Edge recommended).
- Good, even lighting on your hand helps tracking accuracy.

> **Camera & secure context:** MediaPipe needs camera access, which browsers
> only grant on a *secure context*. `localhost` counts as secure, so the local
> dev server works fine. If you serve the app to another device over your LAN IP,
> the camera will be blocked unless it's over **HTTPS**.

---

## Running it

All commands run from the `gesture-tennis/` folder:

```bash
cd gesture-tennis
npm install        # only needed the first time (node_modules may already exist)
npm run dev        # start the Vite dev server
```

Then open the URL Vite prints (usually `http://localhost:5173`) and **allow the
camera permission** when prompted.

### Other scripts

| Command           | What it does                                  |
|-------------------|-----------------------------------------------|
| `npm run dev`     | Start the dev server with hot reload          |
| `npm run build`   | Production build into `dist/`                 |
| `npm run preview` | Serve the built `dist/` locally to test it    |

### First-launch flow

1. Loading overlay → **"Requesting camera permission…"**
2. Camera grants → start screen with a **5-second countdown**.
3. Game begins automatically; the first serve comes ~1.2 s after **READY**.
4. If the camera is denied / missing / not secure, a clear error screen with a
   **Reload** button is shown (handled in
   [`main.js` › `showCameraError`](gesture-tennis/src/main.js)).

---

## Project structure

```
3D tennis game/
├── CLAUDE.md                 # project rules / design constraints
├── README.md                 # this file
└── gesture-tennis/           # the Vite app
    ├── index.html            # DOM, inline CSS, MediaPipe CDN <script> tags
    ├── package.json
    ├── public/               # static assets (favicon, icons)
    ├── dist/                 # production build output
    └── src/
        ├── main.js           # entry point — wires every subsystem together
        ├── game/
        │   ├── Renderer.js    # Three.js scene, camera, lights, render loop
        │   ├── Court.js       # court geometry: surface, lines, net, stands, lights
        │   ├── Ball.js        # ball visuals + two-arc bounce trajectory, trail, shockwave
        │   ├── Opponent.js    # AI silhouette, reaction timing, return-shot logic
        │   ├── GameState.js   # state machine + full tennis scoring engine
        │   └── SoundEngine.js # procedural Web Audio (hit, bounce, cheer, fanfare)
        ├── gesture/
        │   ├── HandTracker.js   # MediaPipe Hands + webcam setup, per-frame landmarks
        │   ├── SwingDetector.js # landmarks → swing events (velocity + classification)
        │   └── GestureOverlay.js# draws the hand skeleton on the preview canvas
        └── ui/
            ├── Scoreboard.js  # tennis scoreboard table (points/games/sets)
            └── HUD.js         # gesture feedback strip, power meter, announcements
```

---

## How it works

The app runs **two independent loops** so hand tracking never blocks rendering:

- **Render / game loop** — `Renderer` drives a `requestAnimationFrame` loop that
  each frame updates the ball, game state, and opponent, then renders the scene.
- **Hand-tracking loop** — MediaPipe's `Camera` utility calls back on every video
  frame with 21 hand landmarks, independently of the render loop.

### Data flow

```
Webcam ─▶ HandTracker ─▶ landmarks ─┬─▶ GestureOverlay (draws skeleton)
                                    └─▶ SwingDetector ─▶ swing event
                                                          │
                                                          ▼
                                                    GameState.handleSwing()
                                                          │
                          ┌───────────────────────────────┼───────────────────────────────┐
                          ▼                               ▼                                 ▼
                     Ball.launch()                 Opponent.receiveReturn()           Scoreboard / HUD
                  (physics + trail)              (delayed AI return shot)            (score + feedback)
```

`main.js` owns **no game logic** — it just constructs every subsystem and wires
their callbacks together (`onSwing`, `onServe`, `onPlayerHit`, `onBounce`,
`onPointWon`, etc.).

### Swing detection ([`SwingDetector.js`](gesture-tennis/src/gesture/SwingDetector.js))

1. Each frame computes a **palm center** (average of 5 anchor landmarks).
2. Positions are pushed into an 8-slot ring buffer.
3. **Velocity** = (newest − oldest) / buffer size — motion is detected from
   *position change per frame*, never position alone.
4. If speed exceeds `SWING_THRESHOLD` and the cooldown has expired, a swing fires.
5. A 45-frame cooldown enforces **one physical motion = one hit**.
6. Type is classified from the velocity vector: strong upward+high wrist = smash,
   otherwise horizontal direction picks forehand vs backhand.

### Scoring & state machine ([`GameState.js`](gesture-tennis/src/game/GameState.js))

```
LOADING → READY → SERVING → RALLY → POINT_OVER → GAME_OVER
```

All score mutations are isolated inside `_awardTennisPoint` / `_awardGame` /
`_awardSet`. Nothing else changes the score. After every point (whether or not it
ends a game) the engine announces the result, enters `POINT_OVER`, and schedules
the next serve.

### Ball physics ([`Ball.js`](gesture-tennis/src/game/Ball.js))

The ball follows **two joined parabolic arcs** with a bounce point between them
(the second arc is lower, simulating energy loss). Spin adds a lateral curve
after the bounce. The ball fires one-shot events — `onBounce`, `onReachPlayer`,
`onReachOpponent` — which `GameState` uses to drive faults, hits, and returns.
It always has a defined trajectory and never teleports.

### Opponent AI ([`Opponent.js`](gesture-tennis/src/game/Opponent.js))

A box-primitive humanoid at the far baseline. Difficulty scales with rally
length: reaction delay shrinks, ball speed rises, and the chance of hitting wide
(a fault) drops as rallies get longer. The right arm is parented to a shoulder
pivot so the swing animation looks natural.

---

## Controls summary

| Action            | Gesture                                       |
|-------------------|-----------------------------------------------|
| Forehand          | Swing hand left → right (fast)                |
| Backhand          | Swing hand right → left (fast)                |
| Smash / overhead  | Swing hand sharply downward from up high      |
| Shot power        | Swing faster                                  |
| Restart (game over) | Hold an open palm steady for 2 seconds      |

The webcam preview (bottom-left) shows your tracked hand skeleton so you can see
exactly what the game reads.

---

## Aesthetic

Dark deep-blue/purple night court, a neon yellow-green ball with a speed-scaled
trail and impact shockwaves, orbiting purple/cyan stadium lights, and a clean
minimal Orbitron UI.

---

## Troubleshooting

| Symptom                          | Likely cause / fix                                              |
|----------------------------------|----------------------------------------------------------------|
| "Camera permission denied"       | Allow camera in browser settings, then reload.                 |
| "No camera found"                | Plug in / enable a webcam and reload.                          |
| "HTTPS required"                 | You're on a non-localhost IP over HTTP — serve over HTTPS.      |
| Hand not detected                | Improve lighting; keep your whole hand in the camera frame.    |
| Swings not registering           | Swing faster, or lower `SWING_THRESHOLD` in `SwingDetector.js`.|
| Too sensitive / phantom hits     | Raise `SWING_THRESHOLD` or increase `COOLDOWN_FRAMES`.         |
| No sound                         | Audio unlocks on your first swing/gesture (browser autoplay policy). |
