// Entry point — wires all subsystems; owns no game logic

import { Renderer }       from './game/Renderer.js';
import { Court }          from './game/Court.js';
import { Ball }           from './game/Ball.js';
import { Opponent }       from './game/Opponent.js';
import { GameState }      from './game/GameState.js';
import { SoundEngine }    from './game/SoundEngine.js';
import { HandTracker }    from './gesture/HandTracker.js';
import { GestureOverlay } from './gesture/GestureOverlay.js';
import { SwingDetector }  from './gesture/SwingDetector.js';
import { Scoreboard }     from './ui/Scoreboard.js';
import { HUD }            from './ui/HUD.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText    = loadingOverlay.querySelector('p');
const previewCanvas  = document.getElementById('webcam-preview');
const gameCanvas     = document.getElementById('game-canvas');

// ─── UI classes ──────────────────────────────────────────────────────────────
const scoreboard = new Scoreboard();
const hud        = new HUD();

// Initial render so the board shows 0s before the first serve
scoreboard.render({
  points:     { player: '0', ai: '0', isDeuce: false },
  games:      { player: 0,  ai: 0  },
  sets:       [],
  inTiebreak: false,
});

// ─── Sound ───────────────────────────────────────────────────────────────────
// Instantiated early; AudioContext created lazily on first user gesture
const soundEngine = new SoundEngine();

// ─── 3D scene ────────────────────────────────────────────────────────────────
const renderer = new Renderer(gameCanvas);
const court    = new Court();
court.addToScene(renderer.scene);

const ball     = new Ball();
ball.addToScene(renderer.scene);

const opponent = new Opponent();
opponent.addToScene(renderer.scene);

// ─── Game state ───────────────────────────────────────────────────────────────
const gameState = new GameState();

// Score updates → refresh scoreboard immediately
gameState.onScoreChange((score) => {
  scoreboard.render(score);
});

// Point / game / set / match result → animated announcement
gameState.onPointWon((winner, type, score) => {
  hud.announce(winner, type, score);
  scoreboard.render(score);
  console.log(`[${type.toUpperCase()}] ${winner}`);

  // Flash court lines on any point win — visible cue that a rally ended decisively
  court.flashLines();

  if (type === 'point' || type === 'game' || type === 'set') {
    // Light cheer for every point; longer burst for a game or set win
    soundEngine.cheer(type === 'point' ? 0.7 : type === 'game' ? 1.2 : 1.8);
  }

  if (type === 'match') {
    opponent.cancel();
    soundEngine.fanfare();
    // Show game-over screen after announcement animation has had time to show
    setTimeout(() => showGameOverScreen(winner, score), 2600);
    const msg = winner === 'player' ? 'YOU WIN THE MATCH!' : 'AI WINS THE MATCH';
    setTimeout(() => hud.showGesture(msg, 0), 2400);
  }
});

// Out / fault notification
gameState.onFault((faulter) => {
  hud.showGesture(faulter === 'player' ? 'OUT — AI POINT' : 'OPPONENT ERROR!', 900);
});

// Game over state (fires onPointWon 'match' first, this just confirms it)
gameState.onStateChange((state) => {
  if (state === 'GAME_OVER') opponent.cancel();
});

// ── Ball launch callbacks ─────────────────────────────────────────────────────

gameState.onServe((shot) => {
  ball.launch(shot.from, shot.to, shot.speed, shot.spin);
});

gameState.onPlayerHit((shot) => {
  ball.flash();
  ball.launch(shot.from, shot.to, shot.speed, shot.spin);

  // Power derived from normalised shot speed; used to tune hit sound pitch
  const power = Math.min(1, Math.max(0, (shot.speed - 11) / 15));
  soundEngine.hit(power);

  const label = { forehand: 'FOREHAND!', backhand: 'BACKHAND!', smash: 'SMASH!' };
  hud.showGesture(label[shot.type] ?? 'HIT!', 700);
});

gameState.onOpponentHit((shot) => {
  ball.launch(shot.from, shot.to, shot.speed, shot.spin);
  soundEngine.hit(0.35);   // opponent hits sound slightly softer than player
});

gameState.onMiss(() => {
  hud.showGesture('MISS!', 700);
});

// ── Ball → GameState routing ─────────────────────────────────────────────────

ball.onBounce((pos) => {
  soundEngine.bounce();
  gameState.handleBounce(pos);
});

ball.onReachPlayer(() => {
  gameState.ballEnteredPlayerZone();
});

ball.onReachOpponent(() => {
  gameState.ballEnteredOpponentZone(ball);
});

// ── GameState ↔ Opponent routing ─────────────────────────────────────────────

gameState.onOpponentReturn((ball) => {
  opponent.receiveReturn(ball, gameState.getRallyCount());
});

opponent.onHit((shot) => {
  gameState.opponentReturned(shot);
});

// ─── Render / game tick ──────────────────────────────────────────────────────
renderer.setTickCallback((delta) => {
  ball.update(delta);
  gameState.update(ball);
  opponent.update(delta, ball);
});

renderer.start();

// ─── Gesture subsystems ──────────────────────────────────────────────────────
const overlay  = new GestureOverlay(previewCanvas);
const detector = new SwingDetector();

detector.onSwing((swing) => {
  // Unlock AudioContext on the first detected swing (a user gesture)
  soundEngine.resume();
  gameState.handleSwing(swing, ball);
});

// ── Open-palm detection state ─────────────────────────────────────────────────
// Used for the game-over restart gesture (hold open palm 2 s → reload).
let isGameOver        = false;
let openPalmStartTime = null;   // null = not currently holding open palm

const tracker = new HandTracker({
  onLandmarks(landmarks) {
    overlay.draw(landmarks);
    detector.update(landmarks);

    // Update power meter bar every frame from live velocity magnitude
    hud.setPower(detector.getCurrentSpeed());

    if (!landmarks) {
      if (!isGameOver) hud.showGesture('SHOW YOUR HAND', 0);
      // Reset open-palm timer if hand disappears
      openPalmStartTime = null;
      hud.updateRestartProgress(0);
      return;
    }

    // Open-palm restart on game-over screen
    if (isGameOver) {
      if (detector.isOpenPalm()) {
        if (openPalmStartTime === null) openPalmStartTime = Date.now();
        const progress = Math.min(1, (Date.now() - openPalmStartTime) / 2000);
        hud.updateRestartProgress(progress);
        if (progress >= 1) location.reload();
      } else {
        openPalmStartTime = null;
        hud.updateRestartProgress(0);
      }
    }
  },
});

// ─── Boot sequence ───────────────────────────────────────────────────────────
async function init() {
  try {
    loadingText.textContent = 'REQUESTING CAMERA PERMISSION…';
    await tracker.start();

    // Fade out loading overlay
    loadingOverlay.style.transition = 'opacity 0.4s';
    loadingOverlay.style.opacity    = '0';
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 420);

    // Show start screen with countdown then auto-launch
    showStartScreen();
  } catch (err) {
    showCameraError(err);
  }
}

// ─── Start screen ─────────────────────────────────────────────────────────────

function showStartScreen() {
  const startScreen = document.getElementById('start-screen');
  const countEl     = document.getElementById('start-countdown');

  startScreen.style.display = 'flex';
  // Fade in using double-rAF trick to ensure CSS transition fires
  startScreen.style.opacity    = '0';
  startScreen.style.transition = 'opacity 0.45s';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    startScreen.style.opacity = '1';
  }));

  let count = 5;
  countEl.textContent = count;

  const tick = setInterval(() => {
    count--;
    countEl.textContent = count;
    // Colour shifts to warm red as the countdown approaches zero
    if (count <= 2) countEl.style.color = '#f87171';
    else if (count <= 3) countEl.style.color = '#fbbf24';

    if (count <= 0) {
      clearInterval(tick);
      // Fade out start screen, then begin the game
      startScreen.style.opacity = '0';
      setTimeout(() => {
        startScreen.style.display = 'none';
        hud.showGesture('GET READY…', 0);
        soundEngine.resume();   // unlock AudioContext before first serve
        gameState.ready();
      }, 450);
    }
  }, 1000);
}

// ─── Game over screen ────────────────────────────────────────────────────────

function showGameOverScreen(winner, score) {
  isGameOver = true;

  const screen  = document.getElementById('gameover-screen');
  const titleEl = document.getElementById('gameover-title');
  const setsEl  = document.getElementById('gameover-sets');

  titleEl.textContent = winner === 'player' ? 'YOU WIN!' : 'AI WINS';
  titleEl.style.color = winner === 'player' ? '#34d399' : '#f87171';

  // Build a readable set-score summary, e.g. "6–4  7–5"
  const setStr = score.sets.map(s => `${s.player}–${s.ai}`).join('   ');
  setsEl.textContent = setStr;

  screen.style.display    = 'flex';
  screen.style.opacity    = '0';
  screen.style.transition = 'opacity 0.5s';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.style.opacity = '1';
  }));
}

// ─── Camera error handler ────────────────────────────────────────────────────

function showCameraError(err) {
  const isPermission =
    err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
  const isNotFound =
    err?.name === 'NotFoundError'   || err?.name === 'DevicesNotFoundError';

  let headline, detail;
  if (isPermission) {
    headline = 'CAMERA PERMISSION DENIED';
    detail   = 'Allow camera access in your browser settings and reload the page.';
  } else if (isNotFound) {
    headline = 'NO CAMERA FOUND';
    detail   = 'Plug in a webcam and reload the page.';
  } else if (location.protocol === 'http:' && location.hostname !== 'localhost') {
    headline = 'HTTPS REQUIRED';
    detail   = 'MediaPipe needs a secure connection. Open this page over HTTPS.';
  } else {
    headline = 'CAMERA ERROR';
    detail   = err?.message ?? 'An unknown error occurred.';
  }

  loadingOverlay.innerHTML = `
    <h1 style="background:linear-gradient(135deg,#f87171,#fb923c);
               -webkit-background-clip:text;-webkit-text-fill-color:transparent;
               background-clip:text;">${headline}</h1>
    <p style="color:rgba(255,255,255,0.6);max-width:340px;text-align:center;
              line-height:1.6;">${detail}</p>
    <button onclick="location.reload()"
            style="margin-top:16px;padding:10px 28px;border:1px solid rgba(160,90,255,0.5);
                   border-radius:8px;background:transparent;color:#fff;
                   font-family:inherit;font-size:0.75rem;letter-spacing:0.15em;
                   cursor:pointer;text-transform:uppercase;">
      RELOAD
    </button>
  `;
}

init();
