// Ball — physics, visuals, and trajectory system
//
// Trajectory model — two parabolic arcs joined at a bounce point:
//
//   Phase 1 (t=0 → tBounce):  start → bouncePoint
//     y = lerp(start.y, 0, lt) + peak1 * 4 * lt * (1 - lt)
//
//   Phase 2 (tBounce → 1):    bouncePoint → end
//     y = lerp(0, end.y, lt) + peak2 * 4 * lt * (1 - lt)
//
//   peak2 = peak1 * 0.45  (energy loss from bounce)
//   tBounce = dist(start, bounce) / totalDist
//
// Spin adds a lateral offset that accumulates quadratically in phase 2,
// simulating the ball curving after it contacts the court.

import * as THREE from 'three';

// Visual constants
const BALL_RADIUS     = 0.12;
const BALL_COLOR      = 0xccff00;   // neon yellow-green
const BALL_EMISSIVE   = 0x88bb00;
const GLOW_COLOR      = 0xddff44;
const GLOW_INTENSITY  = 4;
const GLOW_DISTANCE   = 5;

// Trail
const TRAIL_LENGTH    = 24;         // max positions kept — extra headroom for speed scaling
const TRAIL_COLOR     = 0xccff00;
const TRAIL_OPACITY   = 0.45;       // base opacity; scaled down at low speeds

// Shockwave ring spawned at hit point on flash()
const SHOCK_DURATION  = 0.42;       // seconds for ring to expand and fade
const SHOCK_RADIUS    = 0.08;       // initial TorusGeometry ring radius
const SHOCK_TUBE      = 0.018;      // torus tube thickness
const SHOCK_COLOR     = 0xffffff;   // starts white, fades with opacity

// Physics
const NET_Z           = 0;          // net sits at world z = 0
const NET_CLEAR       = 1.05;       // minimum y at net crossing (slightly above net top)
const COURT_Y         = 0;          // court surface y-coordinate
const SPIN_FACTOR     = 0.9;        // lateral offset per unit of spin at t=1

// "Hittable zone" — fire onReachPlayer when ball enters this z-band
const PLAYER_Z_NEAR   = 3.5;       // player's close reach
const PLAYER_Z_FAR    = 7.5;       // player's far reach

// Opponent zone — fire onReachOpponent when ball crosses this z toward AI
const OPPONENT_Z_NEAR = -8.0;

// Hit flash — scale pulse duration in seconds
const FLASH_DURATION  = 0.18;

function lerp(a, b, t) { return a + (b - a) * t; }

export class Ball {
  constructor() {
    // Three.js objects —­ all parented to _group for easy scene management
    this._group = new THREE.Group();
    this._group.visible = false;     // hidden until first launch()

    this._buildMesh();
    this._buildTrail();

    // Trajectory state
    this._active     = false;
    this._t          = 0;           // progress along full arc [0,1]
    this._duration   = 1;           // seconds for full flight
    this._start      = new THREE.Vector3();
    this._bounce     = new THREE.Vector3();
    this._end        = new THREE.Vector3();
    this._peak1      = 2;           // arc height, phase 1
    this._peak2      = 0.9;         // arc height, phase 2
    this._tBounce    = 0.5;         // t value at which bounce occurs
    this._spin       = 0;           // lateral spin [-1 … +1]

    // One-shot event flags — reset on each launch()
    this._bounceFired        = false;
    this._reachFired         = false;
    this._opponentFired      = false;

    // Flash animation state
    this._flashTimer = 0;   // counts down from FLASH_DURATION to 0

    // Shockwave rings — array of {mesh, timer} objects animated each frame
    this._shockwaves = [];

    // Scene reference stored in addToScene() so shockwaves can be added at root level
    this._scene = null;

    // Speed of current trajectory; used to scale trail length/opacity
    this._launchSpeed = 14;

    // Callbacks
    this._onBounce        = null;
    this._onReachPlayer   = null;
    this._onReachOpponent = null;
  }

  // ─── public API ──────────────────────────────────────────────────────────────

  // Register callbacks — fluent so callers can chain
  onBounce(cb)         { this._onBounce        = cb; return this; }
  onReachPlayer(cb)    { this._onReachPlayer   = cb; return this; }
  onReachOpponent(cb)  { this._onReachOpponent = cb; return this; }

  // Trigger a scale-pulse visual flash and a shockwave ring at the current position.
  // Call when the player successfully hits the ball.
  flash() {
    this._flashTimer = FLASH_DURATION;
    this._spawnShockwave();
  }

  // Start a new trajectory.
  //   from, to  — THREE.Vector3 (or {x,y,z})
  //   speed     — units per second (higher = faster ball)
  //   spin      — lateral curve applied after bounce, range roughly [-1, +1]
  launch(from, to, speed = 14, spin = 0) {
    this._start.set(from.x, from.y, from.z);
    this._end.set(to.x, to.y, to.z);
    this._spin = spin;

    // Bounce location: midpoint between net and destination, on the court surface.
    // Biased 60 % toward destination so the bounce is in the receiver's half.
    const bz = lerp(NET_Z, to.z, 0.60);
    const bx = lerp(from.x, to.x, lerp(0.45, 0.55, 0.5));
    this._bounce.set(bx, COURT_Y, bz);

    // Split the duration proportionally to each phase's 3-D distance
    const d1 = this._start.distanceTo(this._bounce);
    const d2 = this._bounce.distanceTo(this._end);
    const dTotal = d1 + d2 || 1;
    this._tBounce = d1 / dTotal;

    // Peak height: tall enough to clear the net with margin, capped for realism
    const hBase = Math.max(1.6, dTotal * 0.12);
    this._peak1  = hBase;
    this._peak2  = hBase * 0.45;   // post-bounce arc is lower (energy loss)

    // Make sure peak1 arc actually clears the net at z=0
    // The net crossing happens at approximately t = tBounce * (bz-start.z)/... 
    // Rather than exact math, just enforce a minimum peak.
    const minPeakForNet = NET_CLEAR - Math.min(from.y, 0.1);
    if (this._peak1 < minPeakForNet) this._peak1 = minPeakForNet;

    this._duration    = dTotal / Math.max(speed, 0.1);
    this._launchSpeed = speed;   // stored for trail length/opacity scaling
    this._t              = 0;
    this._active         = true;
    this._bounceFired    = false;
    this._reachFired     = false;
    this._opponentFired  = false;

    // Reset trail
    this._trailLen = 0;
    this._trailIdx = 0;
    this._trailBuf.fill(0);

    this._group.visible = true;

    // Snap to starting position immediately
    const startPos = this._posAt(0);
    this._group.position.copy(startPos);
  }

  // Call once per render frame with delta in seconds.
  update(delta) {
    if (!this._active) return;

    this._t += delta / this._duration;
    if (this._t > 1) this._t = 1;

    const pos = this._posAt(this._t);
    this._group.position.copy(pos);

    // ── flash scale pulse on hit ────────────────────────────────────────────────
    if (this._flashTimer > 0) {
      this._flashTimer -= delta;
      // Scale from 2.5× down to 1× over FLASH_DURATION
      const s = 1 + 1.5 * Math.max(0, this._flashTimer / FLASH_DURATION);
      this._mesh.scale.setScalar(s);
    } else {
      this._mesh.scale.setScalar(1);
    }

    // Pulse the glow with a fast sine for a "live ball" feel
    const pulse = 1 + 0.35 * Math.sin(Date.now() * 0.012);
    this._glowLight.intensity = GLOW_INTENSITY * pulse;

    this._pushTrail(pos);
    this._refreshTrailGeo();
    this._animateShockwaves(delta);

    // ── events ──────────────────────────────────────────────────────────────────

    // Bounce: fire once when t crosses tBounce
    if (!this._bounceFired && this._t >= this._tBounce) {
      this._bounceFired = true;
      this._onBounce?.(this._bounce.clone());
    }

    // Reach player: fire once when ball enters the hittable z-band (incoming)
    if (!this._reachFired && pos.z >= PLAYER_Z_NEAR && pos.z <= PLAYER_Z_FAR) {
      this._reachFired = true;
      this._onReachPlayer?.(pos.clone());
    }

    // Reach opponent: fire once when ball crosses into the opponent's zone (outgoing)
    if (!this._opponentFired && pos.z <= OPPONENT_Z_NEAR) {
      this._opponentFired = true;
      this._onReachOpponent?.(pos.clone());
    }

    // End of trajectory
    if (this._t >= 1) {
      this._active = false;
      // Fallback: if ball ended without entering player zone, still notify GameState
      if (!this._reachFired && pos.z > 0) {
        this._reachFired = true;
        this._onReachPlayer?.(pos.clone());
      }
    }
  }

  // Current world position (THREE.Vector3 — new instance each call)
  getPosition() {
    return this._group.position.clone();
  }

  isActive() { return this._active; }

  // ─── private — geometry setup ─────────────────────────────────────────────────

  _buildMesh() {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    const mat = new THREE.MeshPhongMaterial({
      color:            BALL_COLOR,
      emissive:         BALL_EMISSIVE,
      emissiveIntensity: 0.7,
      shininess:        120,
    });
    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.castShadow = true;
    this._group.add(this._mesh);

    // Point light attached to ball so it illuminates surrounding court/net
    this._glowLight = new THREE.PointLight(GLOW_COLOR, GLOW_INTENSITY, GLOW_DISTANCE);
    this._group.add(this._glowLight);
  }

  _buildTrail() {
    // Ring buffer storage — separate from the geometry buffer so we can
    // reorder it oldest-to-newest each frame without touching the geo array.
    this._trailBuf = new Float32Array(TRAIL_LENGTH * 3);
    this._trailIdx = 0;   // next write slot
    this._trailLen = 0;   // valid entries (0 → TRAIL_LENGTH)

    // Geometry buffer that gets uploaded to the GPU each frame
    const positions = new Float32Array(TRAIL_LENGTH * 3);
    this._trailGeo = new THREE.BufferGeometry();
    this._trailAttr = new THREE.BufferAttribute(positions, 3);
    this._trailAttr.setUsage(THREE.DynamicDrawUsage);
    this._trailGeo.setAttribute('position', this._trailAttr);
    this._trailGeo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color:       TRAIL_COLOR,
      transparent: true,
      opacity:     TRAIL_OPACITY,
      depthWrite:  false,   // trail doesn't occlude anything
    });
    this._trailLine = new THREE.Line(this._trailGeo, mat);
    // Trail is in world space — do NOT parent it to _group (group moves with ball)
    // We add it directly to the scene in addToScene().
    this._trailLineRef = this._trailLine; // stored so addToScene can attach it
  }

  addToScene(scene) {
    this._scene = scene;             // stored so shockwaves can be added at root level
    scene.add(this._group);
    scene.add(this._trailLineRef);  // trail lives at scene root (world space)
  }

  // ─── private — physics ───────────────────────────────────────────────────────

  // Parametric position at progress t ∈ [0, 1].
  _posAt(t) {
    const r1 = this._tBounce;
    const r2 = 1 - r1;

    let x, y, z;

    if (t <= r1) {
      // Phase 1: start → bounce
      const lt = r1 > 0 ? t / r1 : 1;
      x = lerp(this._start.x, this._bounce.x, lt);
      y = lerp(this._start.y, COURT_Y, lt) + this._peak1 * 4 * lt * (1 - lt);
      z = lerp(this._start.z, this._bounce.z, lt);
    } else {
      // Phase 2: bounce → end  (+spin lateral offset)
      const lt = r2 > 0 ? (t - r1) / r2 : 1;
      const lateralOffset = this._spin * SPIN_FACTOR * lt * lt;
      x = lerp(this._bounce.x, this._end.x, lt) + lateralOffset;
      y = lerp(COURT_Y, this._end.y, lt) + this._peak2 * 4 * lt * (1 - lt);
      z = lerp(this._bounce.z, this._end.z, lt);
    }

    // Guard: ball should never clip through the court
    if (y < COURT_Y) y = COURT_Y;

    return new THREE.Vector3(x, y, z);
  }

  // ─── private — trail ─────────────────────────────────────────────────────────

  _pushTrail(pos) {
    const i = this._trailIdx * 3;
    this._trailBuf[i]     = pos.x;
    this._trailBuf[i + 1] = pos.y;
    this._trailBuf[i + 2] = pos.z;
    this._trailIdx = (this._trailIdx + 1) % TRAIL_LENGTH;
    if (this._trailLen < TRAIL_LENGTH) this._trailLen++;
  }

  // Re-order the ring buffer oldest→newest into the geometry attribute.
  // Trail length and opacity scale with launch speed so fast shots feel snappier.
  _refreshTrailGeo() {
    const n    = this._trailLen;
    const head = this._trailIdx;
    const dst  = this._trailAttr.array;

    for (let i = 0; i < n; i++) {
      // When buffer is full _trailIdx points to the oldest slot.
      // When not yet full, the oldest slot is always index 0.
      const slot = n < TRAIL_LENGTH
        ? i
        : (head + i) % TRAIL_LENGTH;
      const si = slot * 3;
      const di = i * 3;
      dst[di]     = this._trailBuf[si];
      dst[di + 1] = this._trailBuf[si + 1];
      dst[di + 2] = this._trailBuf[si + 2];
    }

    this._trailAttr.needsUpdate = true;

    // Speed normalised to [0,1] range (10 → slow serve, 30 → hard smash)
    const speedT = Math.min(1, Math.max(0, (this._launchSpeed - 10) / 20));

    // Visible trail length: 5 positions at low speed, full buffer at high speed
    const visibleLen = Math.floor(5 + speedT * (TRAIL_LENGTH - 5));
    this._trailGeo.setDrawRange(0, Math.max(1, Math.min(n, visibleLen)));

    // Opacity: dim at low speed, bright at high speed
    this._trailLine.material.opacity = 0.18 + speedT * 0.52;
  }

  // ─── private — shockwave ─────────────────────────────────────────────────────

  // Spawn a flat ring at the ball's current position that expands and fades out.
  // The ring sits in XZ plane (court surface) for a satisfying ground-impact look.
  _spawnShockwave() {
    if (!this._scene) return;   // addToScene() not yet called

    const geo = new THREE.TorusGeometry(SHOCK_RADIUS, SHOCK_TUBE, 8, 48);
    const mat = new THREE.MeshBasicMaterial({
      color:       SHOCK_COLOR,
      transparent: true,
      opacity:     0.85,
      depthWrite:  false,   // ring should not occlude other objects
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Position at ball's current world location, lying flat on the court plane
    mesh.position.copy(this._group.position);
    mesh.rotation.x = -Math.PI / 2;   // rotate so ring is horizontal (XZ plane)

    this._scene.add(mesh);
    this._shockwaves.push({ mesh, timer: 0 });
  }

  // Expand and fade each active shockwave; remove when animation is complete.
  _animateShockwaves(delta) {
    for (let i = this._shockwaves.length - 1; i >= 0; i--) {
      const sw = this._shockwaves[i];
      sw.timer += delta;
      const progress = sw.timer / SHOCK_DURATION;  // 0 → 1

      if (progress >= 1) {
        // Animation complete — remove from scene and array
        this._scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this._shockwaves.splice(i, 1);
        continue;
      }

      // Scale ring outward: starts tiny, reaches ~4× initial radius at end
      const scale = 1 + progress * 9;
      sw.mesh.scale.set(scale, scale, scale);

      // Fade out: fast at first (feels snappy), then slower tail
      sw.mesh.material.opacity = 0.85 * (1 - progress * progress);
    }
  }
}
