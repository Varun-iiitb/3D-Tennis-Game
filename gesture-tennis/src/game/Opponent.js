// Opponent — AI silhouette, reaction logic, and return shot computation
//
// Difficulty scales with rallyCount (queried from GameState each return):
//   Reaction delay:  max(140, 460 - rallyCount * 16)  ms
//   Ball speed:      min(22,  12  + rallyCount * 0.45) units/s
//   Fault chance:    max(0.02, 0.12 - rallyCount * 0.005)
//
// Visual: box-primitive humanoid at opponent baseline (z ≈ -12).
// Right arm is parented to a shoulder pivot so rotation is anatomically correct.
// The figure slides laterally toward the ball's x position each frame.

import * as THREE from 'three';

// ─── Layout constants ─────────────────────────────────────────────────────────
const BASE_Z          = -12.0;   // opponent stands just behind their baseline
const HIT_Z           = -11.2;   // z position used as shot origin
const HIT_Y           =  2.0;    // hitting height
const COURT_HALF_W    =  4.115;  // singles sideline ±x
const PLAYER_Z_TARGET =  6.0;    // default z when aiming at player
const PLAYER_Z_SPREAD =  1.4;    // ± random depth variation

// ─── Animation ────────────────────────────────────────────────────────────────
const SWING_DURATION  = 0.38;    // seconds for one arm-swing cycle
const LATERAL_SPEED   = 3.5;     // units/s for figure sliding to track ball

// ─── Material ─────────────────────────────────────────────────────────────────
const MAT = new THREE.MeshStandardMaterial({
  color:     0x1a0a2e,
  emissive:  0x3a1a5e,
  emissiveIntensity: 0.35,
  roughness: 0.9,
});

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

export class Opponent {
  constructor() {
    this._group      = new THREE.Group();
    this._group.position.set(0, 0, BASE_Z);

    this._pendingHit  = null;    // setTimeout handle — cancelled on new rally
    this._armTimer    = 0;       // arm-swing progress timer
    this._targetX     = 0;       // lateral position the figure tracks toward

    this._onHit       = null;    // (shot) → GameState.opponentReturned()

    this._buildSilhouette();
  }

  // ─── public API ──────────────────────────────────────────────────────────────

  addToScene(scene) { scene.add(this._group); }

  onHit(cb) { this._onHit = cb; return this; }

  // Called by GameState when the ball enters the opponent zone.
  // rallyCount — current length of the rally, used to scale difficulty.
  receiveReturn(ball, rallyCount) {
    clearTimeout(this._pendingHit);

    const ballPos = ball.getPosition();
    this._targetX = ballPos.x * 0.6;   // slide toward ball's lateral position

    const shot  = this._decideReturn(ballPos, rallyCount);
    const delay = Math.max(140, 460 - rallyCount * 16);

    this._pendingHit = setTimeout(() => {
      this._triggerSwingAnimation();
      this._onHit?.(shot);
    }, delay);
  }

  // Call each render frame with delta in seconds.
  update(delta, ball) {
    this._animateArm(delta);
    this._trackBall(delta, ball);
  }

  // Cancel any pending return (e.g. on point-over / game-over).
  cancel() {
    clearTimeout(this._pendingHit);
  }

  // ─── private — shot computation ───────────────────────────────────────────────

  _decideReturn(ballPos, rallyCount) {
    // Fault: opponent occasionally hits wide (less often as rallies get longer)
    const faultChance = Math.max(0.02, 0.12 - rallyCount * 0.005);
    const isFault     = Math.random() < faultChance;

    // Cross-court vs down-the-line
    // At low rally counts, more cross-court variety; later, more down-the-line precision
    const crossCourt = Math.random() > 0.42;

    let toX;
    if (crossCourt) {
      // Mirror the ball's lateral position across centre
      toX = -(ballPos.x * 0.9) + (Math.random() - 0.5) * 1.2;
    } else {
      // Same side as where the ball came from
      toX = ballPos.x * 0.75 + (Math.random() - 0.5) * 0.8;
    }

    if (isFault) {
      // Deliberately aim wide — ball lands beyond the sideline
      toX = (toX >= 0 ? 1 : -1) * (COURT_HALF_W + 0.3 + Math.random() * 0.6);
    } else {
      toX = Math.max(-COURT_HALF_W + 0.2, Math.min(COURT_HALF_W - 0.2, toX));
    }

    const toZ  = PLAYER_Z_TARGET + (Math.random() - 0.5) * PLAYER_Z_SPREAD;
    const speed = Math.min(22, 12 + rallyCount * 0.45) + (Math.random() - 0.5) * 1.5;
    const spin  = (Math.random() - 0.5) * 0.5;

    return {
      from:   new THREE.Vector3(this._group.position.x, HIT_Y, HIT_Z),
      to:     new THREE.Vector3(toX, 1.1, toZ),
      speed:  Math.max(10, speed),
      spin,
      isOut:  isFault,           // GameState uses this to detect faults
    };
  }

  // ─── private — animation ─────────────────────────────────────────────────────

  _triggerSwingAnimation() {
    this._armTimer = SWING_DURATION;
  }

  _animateArm(delta) {
    if (this._armTimer <= 0) {
      // Ensure arm returns to rest
      this._rightPivot.rotation.x = 0;
      this._rightPivot.rotation.z = 0;
      return;
    }
    this._armTimer = Math.max(0, this._armTimer - delta);
    const progress = 1 - this._armTimer / SWING_DURATION;
    // Sine arch: 0 → peak (-PI/2) → back to 0
    const angle = Math.sin(progress * Math.PI) * (-Math.PI / 1.8);
    this._rightPivot.rotation.x = angle;
    this._rightPivot.rotation.z = angle * 0.25;  // slight outward sweep
  }

  _trackBall(delta, ball) {
    // Slide figure toward _targetX each frame (only when ball is in play)
    if (!ball || !ball.isActive()) return;
    const dx = this._targetX - this._group.position.x;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), LATERAL_SPEED * delta);
    this._group.position.x += step;
  }

  // ─── private — geometry ──────────────────────────────────────────────────────

  _buildSilhouette() {
    const add = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, MAT);
      m.position.set(x, y, z);
      m.castShadow = true;
      this._group.add(m);
      return m;
    };

    // Head
    add(box(0.40, 0.40, 0.32), 0, 2.22, 0);
    // Neck
    add(box(0.18, 0.18, 0.18), 0, 1.90, 0);
    // Torso
    add(box(0.62, 0.78, 0.28), 0, 1.51, 0);
    // Hips
    add(box(0.52, 0.22, 0.24), 0, 1.10, 0);

    // Left arm (non-hitting, static)
    add(box(0.20, 0.64, 0.20), -0.52, 1.50, 0);

    // Right arm — pivoted at shoulder so rotation swings the arm naturally
    // The pivot sits at shoulder height; the arm mesh hangs down from it.
    this._rightPivot = new THREE.Group();
    this._rightPivot.position.set(0.52, 1.80, 0);   // shoulder position (local to _group)
    this._group.add(this._rightPivot);

    const rightArmMesh = new THREE.Mesh(box(0.20, 0.64, 0.20), MAT);
    rightArmMesh.position.set(0, -0.35, 0);          // arm hangs 0.35 below pivot
    rightArmMesh.castShadow = true;
    this._rightPivot.add(rightArmMesh);

    // Legs
    add(box(0.25, 0.78, 0.25),  0.20, 0.42, 0);
    add(box(0.25, 0.78, 0.25), -0.20, 0.42, 0);

    // Feet (small boxes)
    add(box(0.28, 0.10, 0.38),  0.20, 0.04, 0.06);
    add(box(0.28, 0.10, 0.38), -0.20, 0.04, 0.06);
  }
}
