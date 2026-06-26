// SwingDetector — converts per-frame hand landmarks into discrete swing events
//
// Algorithm:
//   1. Each frame, compute palm center (avg of landmarks 0,5,9,13,17).
//   2. Push it into an 8-slot circular buffer.
//   3. Velocity = (newest - oldest) / BUFFER_SIZE  (normalised-coord units/frame)
//   4. If |velocity| > SWING_THRESHOLD and cooldown has expired → emit swing.
//   5. 45-frame cooldown prevents one physical motion firing multiple hits.
//
// Swing type classification:
//   smash   — dy strongly negative (hand moving upward in image = downward in
//              screen coords where y=0 is top) AND wrist above mid-frame (y < 0.45)
//   forehand  — primary horizontal component, dx > 0 (left→right)
//   backhand  — primary horizontal component, dx < 0 (right→left)

// Tune this to taste — lower = more sensitive, higher = requires harder swings
const SWING_THRESHOLD = 0.018;

// Number of frames to look back when calculating velocity
const BUFFER_SIZE = 8;

// Frames to ignore after a swing fires (≈ 0.75 s at 60 fps)
const COOLDOWN_FRAMES = 45;

// dy must be more negative than this (fast upward motion) to classify as smash
const SMASH_DY_THRESHOLD = -0.022;

// Wrist must be in the upper portion of the frame to count as a smash setup
const SMASH_Y_CEILING = 0.45;

export class SwingDetector {
  constructor() {
    this._onSwing = null;

    // Circular buffer of {x, y} palm positions (normalised [0,1] coords)
    this._buffer = new Array(BUFFER_SIZE).fill(null);
    this._bufferIndex = 0;
    this._bufferFull = false;  // true once we've written at least BUFFER_SIZE frames

    this._cooldown = 0;  // counts down to 0 between swings

    // Current velocity magnitude kept up-to-date each frame for the power meter
    this._currentSpeed = 0;

    // Last known landmarks — kept so isOpenPalm() can be queried without re-processing
    this._lastLandmarks = null;
  }

  // Register the callback that receives swing events.
  // callback: ({ type, direction: {x,y}, speed }) => void
  onSwing(callback) {
    this._onSwing = callback;
    return this;  // fluent
  }

  // Current hand velocity magnitude in normalised-coord units/frame [0 → ~0.1+].
  // Returns 0 when no hand is visible or buffer is not yet full.
  // Useful for driving the power-meter HUD without waiting for a full swing event.
  getCurrentSpeed() {
    return this._currentSpeed;
  }

  // Returns true when all four fingers (index→pinky) appear extended.
  // Uses the last frame's landmarks so no extra computation is needed.
  // Heuristic: fingertip y < MCP (base knuckle) y — works for upright palms.
  // The thumb is excluded because its axis is perpendicular and complicates the check.
  isOpenPalm() {
    const lm = this._lastLandmarks;
    if (!lm) return false;
    // [fingertip index, MCP index] pairs for index, middle, ring, pinky
    const pairs = [[8, 5], [12, 9], [16, 13], [20, 17]];
    return pairs.every(([tip, mcp]) => lm[tip].y < lm[mcp].y);
  }

  // Feed one frame of landmarks (21-point array or null when no hand visible).
  // Call this inside HandTracker's onLandmarks callback every frame.
  update(landmarks) {
    if (this._cooldown > 0) this._cooldown--;

    this._lastLandmarks = landmarks;   // store for isOpenPalm() queries

    if (!landmarks) {
      // No hand — keep the buffer advancing with nulls so stale data doesn't
      // linger and cause a phantom swing when the hand reappears.
      this._push(null);
      this._currentSpeed = 0;
      return;
    }

    const palm = this._palmCenter(landmarks);
    this._push(palm);

    if (!this._bufferFull) return;  // not enough history yet

    const velocity = this._velocity();
    if (!velocity) {
      this._currentSpeed = 0;
      return;    // buffer contains null slots (hand was absent)
    }

    const speed = Math.hypot(velocity.x, velocity.y);

    // Always update power meter, even during cooldown
    this._currentSpeed = speed;

    if (speed < SWING_THRESHOLD) return;
    if (this._cooldown > 0) return;

    // ── classify swing type ──────────────────────────────────────────────────
    const wristY = landmarks[0].y;  // landmark 0 = wrist; y=0 is top of frame
    const isSmash =
      velocity.y < SMASH_DY_THRESHOLD && wristY < SMASH_Y_CEILING;

    let type;
    if (isSmash) {
      type = 'smash';
    } else if (velocity.x > 0) {
      type = 'forehand';
    } else {
      type = 'backhand';
    }

    // Normalise direction vector
    const direction = { x: velocity.x / speed, y: velocity.y / speed };

    this._cooldown = COOLDOWN_FRAMES;

    this._onSwing?.({ type, direction, speed });
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  // Average the five anchor landmarks that define the palm plane.
  // Using 0 (wrist) + 4 knuckles gives a stable centre that is less jittery
  // than the wrist alone and less affected by finger curl than fingertips.
  _palmCenter(lm) {
    const indices = [0, 5, 9, 13, 17];
    let sx = 0, sy = 0;
    for (const i of indices) {
      sx += lm[i].x;
      sy += lm[i].y;
    }
    return { x: sx / indices.length, y: sy / indices.length };
  }

  _push(point) {
    this._buffer[this._bufferIndex] = point;
    this._bufferIndex = (this._bufferIndex + 1) % BUFFER_SIZE;
    if (this._bufferIndex === 0) this._bufferFull = true;
  }

  // Velocity = displacement from oldest slot to newest slot / BUFFER_SIZE.
  // Returns null if either end of the buffer is null (hand was absent).
  _velocity() {
    // After _push, _bufferIndex points to the NEXT slot to write,
    // which is currently the OLDEST entry.
    const oldest = this._buffer[this._bufferIndex];
    // Newest is one slot behind _bufferIndex
    const newestIdx = (this._bufferIndex + BUFFER_SIZE - 1) % BUFFER_SIZE;
    const newest = this._buffer[newestIdx];

    if (!oldest || !newest) return null;

    return {
      x: (newest.x - oldest.x) / BUFFER_SIZE,
      y: (newest.y - oldest.y) / BUFFER_SIZE,
    };
  }
}
