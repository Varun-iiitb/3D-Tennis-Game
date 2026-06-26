// HUD — gesture feedback strip and centred point-announcement overlay
//
// The gesture strip (#gesture-hud) shows swing labels, MISS, etc.
// The announcement (#point-announcement) shows large centred text for 2 s
// after each rally ends, with colour and sub-text varying by event type.

const WINNER_COLOR  = '#34d399';   // green — player wins
const LOSER_COLOR   = '#f87171';   // red   — AI wins

// Map (winner, type) → { main, sub, color }
function buildAnnouncement(winner, type, score) {
  const isPlayer = winner === 'player';
  const color    = isPlayer ? WINNER_COLOR : LOSER_COLOR;

  switch (type) {
    case 'point':
      return {
        main:  isPlayer ? 'YOUR POINT'     : "OPPONENT'S POINT",
        sub:   '',
        color,
      };

    case 'game': {
      const gp = score.games.player;
      const ga = score.games.ai;
      const setIdx = score.sets.length + 1;
      return {
        main:  isPlayer ? 'YOUR GAME!'     : "AI'S GAME",
        sub:   `SET ${setIdx}  —  ${gp} : ${ga}`,
        color,
      };
    }

    case 'set': {
      const setsWon = { player: 0, ai: 0 };
      for (const s of score.sets) {
        if (s.player > s.ai) setsWon.player++;
        else                  setsWon.ai++;
      }
      return {
        main:  isPlayer ? 'YOUR SET!'      : 'AI WINS SET',
        sub:   `Sets  ${setsWon.player} – ${setsWon.ai}`,
        color,
      };
    }

    case 'match':
      return {
        main:  isPlayer ? 'YOU WIN!'       : 'AI WINS',
        sub:   'MATCH OVER',
        color,
      };

    default:
      return { main: isPlayer ? 'POINT' : 'AI POINT', sub: '', color };
  }
}

// Swing speed range for normalising the power meter display.
// Values outside this range are clamped; tuned to match SwingDetector thresholds.
const POWER_SPEED_MIN = 0.012;   // starts glowing at this speed
const POWER_SPEED_MAX = 0.09;    // full bar at this speed (very hard swing)

export class HUD {
  constructor() {
    this._gestureEl  = document.getElementById('gesture-hud');
    this._announceEl = document.getElementById('point-announcement');
    this._mainEl     = this._announceEl.querySelector('.announce-main');
    this._subEl      = this._announceEl.querySelector('.announce-sub');
    this._powerBar   = document.getElementById('power-meter-bar');
    this._clearTimer = null;
    this._announceTimer = null;
  }

  // Show a short-lived message in the gesture strip.
  // duration=0 keeps it until the next showGesture call.
  showGesture(msg, duration) {
    this._gestureEl.textContent = msg;
    clearTimeout(this._clearTimer);
    if (duration > 0) {
      this._clearTimer = setTimeout(() => {
        this._gestureEl.textContent = 'SHOW YOUR HAND';
      }, duration);
    }
  }

  // Update the power-meter bar (called every frame from the gesture loop).
  // speed — raw velocity magnitude from SwingDetector.getCurrentSpeed()
  setPower(speed) {
    if (!this._powerBar) return;
    // Normalise to [0,1] and clamp so bar doesn't overflow
    const t = Math.min(1, Math.max(0, (speed - POWER_SPEED_MIN) / (POWER_SPEED_MAX - POWER_SPEED_MIN)));
    this._powerBar.style.width = `${Math.round(t * 100)}%`;

    // Colour: green → yellow → red as power increases for quick visual feedback
    if (t < 0.5) {
      // Green to yellow
      const r = Math.round(t * 2 * 255);
      this._powerBar.style.background = `rgb(${r},220,80)`;
    } else {
      // Yellow to red
      const g = Math.round((1 - (t - 0.5) * 2) * 200);
      this._powerBar.style.background = `rgb(255,${g},40)`;
    }
  }

  // Update the restart-gesture progress ring on the game-over screen.
  // progress [0-1] drives the fill of a CSS clip-path circle.
  updateRestartProgress(progress) {
    const el = document.getElementById('restart-progress');
    if (!el) return;
    const pct = Math.round(progress * 100);
    // CSS conic-gradient trick: fills a circle from the top clockwise
    el.style.background =
      `conic-gradient(rgba(120,255,180,0.9) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
    const label = document.getElementById('restart-label');
    if (label) {
      const secs = ((1 - progress) * 2).toFixed(1);
      label.textContent = progress > 0 ? `${secs}s` : 'HOLD OPEN PALM';
    }
  }

  // Show the centred announcement overlay for ~2 seconds.
  announce(winner, type, score) {
    const { main, sub, color } = buildAnnouncement(winner, type, score);

    // Reset animation by removing class, forcing reflow, re-adding
    this._announceEl.classList.remove('show');
    void this._announceEl.offsetWidth;  // force reflow

    this._mainEl.textContent        = main;
    this._subEl.textContent         = sub;
    this._announceEl.style.color    = color;
    this._announceEl.classList.add('show');

    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => {
      this._announceEl.classList.remove('show');
    }, 2200);
  }
}
