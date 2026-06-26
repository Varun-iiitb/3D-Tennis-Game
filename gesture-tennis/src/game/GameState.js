// GameState — tennis score engine + state machine
//
// Scoring hierarchy:  points → games → sets → match
//
//   Points:  0 15 30 40  |  Deuce → Advantage → Game
//   Games:   first to 6, win by 2  (tiebreak at 6-6, first to 7 win by 2)
//   Sets:    best of 3
//
// State machine:  LOADING → READY → SERVING → RALLY → POINT_OVER → GAME_OVER
//
// Score mutations are isolated inside _awardTennisPoint / _awardGame / _awardSet.
// Nothing else changes _tennis.

import * as THREE from 'three';

// ─── Hittable zone ────────────────────────────────────────────────────────────
const HIT_Z_MIN =  5.0;
const HIT_Z_MAX =  7.8;
const HIT_Y_MIN =  0.25;
const HIT_Y_MAX =  2.7;
const HIT_X_MAX =  3.8;

// ─── Court bounds ─────────────────────────────────────────────────────────────
const COURT_HALF_W   = 4.115;
const COURT_HALF_LEN = 11.885;

// ─── Shot parameters ─────────────────────────────────────────────────────────
const OPPONENT_BASELINE_Z = -11.0;
const OPPONENT_SERVE_Y    =  2.0;
const PLAYER_HIT_Y        =  1.4;
const PLAYER_HIT_Z        =  6.2;

const SPEED_MIN_SWING =  0.018;
const SPEED_MAX_SWING =  0.10;
const BALL_SPEED_MIN  = 11;
const BALL_SPEED_MAX  = 26;

// Delays (ms) before the next serve, keyed by event type
const SERVE_DELAY = { point: 2100, game: 2700, set: 3600 };

// ─── Tennis helpers ──────────────────────────────────────────────────────────
const POINT_LABELS = ['0', '15', '30', '40'];

function pointDisplay(p, a) {
  // Both at deuce (3-3) or beyond
  if (p >= 3 && a >= 3) {
    if (p === a) return { player: '40', ai: '40', isDeuce: true };
    return p > a
      ? { player: 'AD', ai: '40', isDeuce: false }
      : { player: '40', ai: 'AD', isDeuce: false };
  }
  return {
    player:  POINT_LABELS[Math.min(p, 3)],
    ai:      POINT_LABELS[Math.min(a, 3)],
    isDeuce: false,
  };
}

export class GameState {
  constructor() {
    this._state = 'LOADING';

    // Full tennis score object — mutated only inside _award* methods
    this._tennis = {
      pts:        { player: 0, ai: 0 },
      games:      { player: 0, ai: 0 },
      sets:       [],          // [{player,ai}, …] completed sets
      inTiebreak: false,
    };

    // Rally tracking
    this._rallyCount    = 0;
    this._awaitingSwing = false;
    this._swingConsumed = false;
    this._ballDirection = 'toPlayer';
    this._ballWasActive = false;

    // Callbacks
    this._cbScoreChange    = null;
    this._cbStateChange    = null;
    this._cbPlayerHit      = null;
    this._cbOpponentReturn = null;
    this._cbOpponentHit    = null;
    this._cbMiss           = null;
    this._cbFault          = null;
    // onPointWon: (winner, type:'point'|'game'|'set'|'match', score) → void
    this._cbPointWon       = null;
    this._cbServe          = null;
  }

  // ─── callback registration ────────────────────────────────────────────────────
  onScoreChange(cb)    { this._cbScoreChange    = cb; return this; }
  onStateChange(cb)    { this._cbStateChange    = cb; return this; }
  onPlayerHit(cb)      { this._cbPlayerHit      = cb; return this; }
  onOpponentReturn(cb) { this._cbOpponentReturn = cb; return this; }
  onOpponentHit(cb)    { this._cbOpponentHit    = cb; return this; }
  onMiss(cb)           { this._cbMiss           = cb; return this; }
  onFault(cb)          { this._cbFault          = cb; return this; }
  onPointWon(cb)       { this._cbPointWon       = cb; return this; }
  onServe(cb)          { this._cbServe          = cb; return this; }

  getState()       { return this._state; }
  getRallyCount()  { return this._rallyCount; }

  getScore() {
    const { pts, games, sets, inTiebreak } = this._tennis;
    return {
      points:     pointDisplay(pts.player, pts.ai),
      games:      { ...games },
      sets:       sets.map(s => ({ ...s })),
      inTiebreak,
    };
  }

  // ─── lifecycle ───────────────────────────────────────────────────────────────

  ready() {
    this._setState('READY');
    setTimeout(() => this._serve(), 1200);
  }

  // ─── per-frame update ─────────────────────────────────────────────────────────

  update(ball) {
    const isActive  = ball.isActive();
    const wasActive = this._ballWasActive;
    this._ballWasActive = isActive;

    if (this._state !== 'RALLY') return;

    if (wasActive && !isActive) {
      if (this._awaitingSwing && this._ballDirection === 'toPlayer') {
        this._awaitingSwing = false;
        this._awardTennisPoint('ai');
      }
    }
  }

  // ─── ball zone events ─────────────────────────────────────────────────────────

  ballEnteredPlayerZone() {
    if (this._state !== 'RALLY' || this._ballDirection !== 'toPlayer') return;
    this._awaitingSwing = true;
    this._swingConsumed = false;
  }

  ballEnteredOpponentZone(ball) {
    if (this._state !== 'RALLY' || this._ballDirection !== 'toOpponent') return;
    this._cbOpponentReturn?.(ball);
  }

  handleBounce(bouncePos) {
    if (this._state !== 'RALLY') return;
    if (this._ballDirection === 'toPlayer'   && bouncePos.z < -0.3) {
      this._cbFault?.('ai');
      this._awardTennisPoint('player');
    } else if (this._ballDirection === 'toOpponent' && bouncePos.z >  0.3) {
      this._cbFault?.('player');
      this._awardTennisPoint('ai');
    }
  }

  // ─── swing handling ───────────────────────────────────────────────────────────

  handleSwing(swing, ball) {
    if (this._state !== 'RALLY') return;
    if (this._swingConsumed) return;
    this._swingConsumed = true;

    const pos    = ball.getPosition();
    const inZone = this._isInHittableZone(pos) && this._ballDirection === 'toPlayer';

    if (!inZone || !ball.isActive()) {
      this._cbMiss?.();
      return;
    }

    this._awaitingSwing = false;
    this._ballDirection = 'toOpponent';
    this._rallyCount++;

    const shot = this._computeReturn(swing, pos);
    if (shot.isOut) {
      this._cbPlayerHit?.(shot);
      this._cbFault?.('player');
      setTimeout(() => this._awardTennisPoint('ai'), 900);
      return;
    }
    this._cbPlayerHit?.(shot);
  }

  // ─── opponent return ─────────────────────────────────────────────────────────

  opponentReturned(shot) {
    if (this._state !== 'RALLY') return;
    if (shot.isOut) {
      this._cbFault?.('ai');
      this._awardTennisPoint('player');
      return;
    }
    this._rallyCount++;
    this._ballDirection = 'toPlayer';
    this._awaitingSwing = false;
    this._swingConsumed = false;
    this._cbOpponentHit?.(shot);
  }

  // ─── tennis scoring engine ────────────────────────────────────────────────────

  _awardTennisPoint(winner) {
    if (this._state === 'GAME_OVER' || this._state === 'POINT_OVER') return;

    const loser = winner === 'player' ? 'ai' : 'player';
    this._tennis.pts[winner]++;

    const wp = this._tennis.pts[winner];
    const lp = this._tennis.pts[loser];

    // Fire score change so the scoreboard updates immediately
    this._cbScoreChange?.(this.getScore());

    if (this._tennis.inTiebreak) {
      // Tiebreak: first to 7, win by 2
      if (wp >= 7 && (wp - lp) >= 2) {
        this._awardGame(winner);
      } else {
        this._endPoint(winner);
      }
      return;
    }

    // Normal: game won when 4+ points and leading by 2+ (or other player <3)
    if (wp >= 4 && (lp < 3 || (wp - lp) >= 2)) {
      this._awardGame(winner);
    } else {
      this._endPoint(winner);
    }
  }

  // Point won but the game continues — announce it and queue the next serve.
  _endPoint(winner) {
    this._cbPointWon?.(winner, 'point', this.getScore());
    this._setState('POINT_OVER');
    setTimeout(() => { if (this._state !== 'GAME_OVER') this._serve(); }, SERVE_DELAY.point);
  }

  _awardGame(winner) {
    this._tennis.pts    = { player: 0, ai: 0 };
    this._tennis.games[winner]++;
    this._tennis.inTiebreak = false;

    const pg = this._tennis.games.player;
    const ag = this._tennis.games.ai;

    // Enter tiebreak at 6-6
    if (pg === 6 && ag === 6) {
      this._tennis.inTiebreak = true;
      this._cbScoreChange?.(this.getScore());
      this._cbPointWon?.(winner, 'game', this.getScore());
      this._setState('POINT_OVER');
      setTimeout(() => { if (this._state !== 'GAME_OVER') this._serve(); }, SERVE_DELAY.game);
      return;
    }

    // Set won: first to 6 with 2-game lead (or 7-5)
    const maxG = Math.max(pg, ag);
    if (maxG >= 6 && Math.abs(pg - ag) >= 2) {
      this._awardSet(winner);
      return;
    }

    this._cbScoreChange?.(this.getScore());
    this._cbPointWon?.(winner, 'game', this.getScore());
    this._setState('POINT_OVER');
    setTimeout(() => { if (this._state !== 'GAME_OVER') this._serve(); }, SERVE_DELAY.game);
  }

  _awardSet(winner) {
    this._tennis.sets.push({ ...this._tennis.games });
    this._tennis.games      = { player: 0, ai: 0 };
    this._tennis.pts        = { player: 0, ai: 0 };
    this._tennis.inTiebreak = false;

    // Count sets won per side
    const setsWon = { player: 0, ai: 0 };
    for (const s of this._tennis.sets) {
      if (s.player > s.ai) setsWon.player++;
      else                  setsWon.ai++;
    }

    this._cbScoreChange?.(this.getScore());

    if (setsWon[winner] >= 2) {
      // Match won
      this._cbPointWon?.(winner, 'match', this.getScore());
      this._setState('GAME_OVER');
      return;
    }

    this._cbPointWon?.(winner, 'set', this.getScore());
    this._setState('POINT_OVER');
    setTimeout(() => { if (this._state !== 'GAME_OVER') this._serve(); }, SERVE_DELAY.set);
  }

  // ─── serve ────────────────────────────────────────────────────────────────────

  _serve() {
    if (this._state === 'GAME_OVER') return;
    this._setState('SERVING');
    this._rallyCount    = 0;
    this._ballDirection = 'toPlayer';
    this._awaitingSwing = false;
    this._swingConsumed = false;

    const toX  = (Math.random() - 0.5) * 4.5;
    const toZ  = 5.5 + Math.random() * 1.5;
    const from = new THREE.Vector3((Math.random() - 0.5) * 2.5, OPPONENT_SERVE_Y, OPPONENT_BASELINE_Z);
    const to   = new THREE.Vector3(toX, 1.1, toZ);

    this._cbServe?.({ from, to, speed: 12 + Math.random() * 4, spin: (Math.random() - 0.5) * 0.4 });
    this._setState('RALLY');
  }

  // ─── player return shot computation ──────────────────────────────────────────

  _computeReturn(swing, hitPos) {
    const from = new THREE.Vector3(hitPos.x, PLAYER_HIT_Y, PLAYER_HIT_Z);
    let toX, toZ;

    if (swing.type === 'smash') {
      toX = swing.direction.x * 1.8;
      toZ = OPPONENT_BASELINE_Z + 0.5;
    } else if (swing.type === 'forehand') {
      toX = swing.direction.x * 3.5 + (Math.random() * 0.6 - 0.3);
      toZ = OPPONENT_BASELINE_Z + Math.random() * 2.0;
    } else {
      toX = swing.direction.x * 3.0 + (Math.random() * 0.6 - 0.3);
      toZ = OPPONENT_BASELINE_Z + Math.random() * 1.5;
    }

    const isOut = Math.abs(toX) > COURT_HALF_W || toZ < -(COURT_HALF_LEN + 0.1);
    toX = Math.max(-(COURT_HALF_W + 0.8), Math.min(COURT_HALF_W + 0.8, toX));
    toZ = Math.max(OPPONENT_BASELINE_Z - 0.6, Math.min(-5.0, toZ));

    const t     = Math.min(1, (swing.speed - SPEED_MIN_SWING) / (SPEED_MAX_SWING - SPEED_MIN_SWING));
    const speed = BALL_SPEED_MIN + t * (BALL_SPEED_MAX - BALL_SPEED_MIN);

    return {
      from,
      to:    new THREE.Vector3(toX, 1.0, toZ),
      speed: swing.type === 'smash' ? Math.min(speed * 1.35, 30) : speed,
      spin:  swing.direction.x * (swing.type === 'smash' ? 0.2 : 0.55),
      type:  swing.type,
      isOut,
    };
  }

  // ─── private helpers ─────────────────────────────────────────────────────────

  _isInHittableZone(pos) {
    return (
      pos.z >= HIT_Z_MIN && pos.z <= HIT_Z_MAX &&
      pos.y >= HIT_Y_MIN && pos.y <= HIT_Y_MAX &&
      Math.abs(pos.x) <= HIT_X_MAX
    );
  }

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    this._cbStateChange?.(s);
  }
}
