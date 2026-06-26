// Court — tennis court geometry built from Three.js primitives
//
// Real singles court:  23.77 m long, 8.23 m wide.
// We use a 1-unit ≈ 1-metre scale, centred at world origin.
// Player baseline is at z = +11.89, opponent baseline at z = -11.89.
// Net sits at z = 0.
//
// Coordinate conventions:
//   +X = right (from player's POV)
//   +Y = up
//   +Z = toward camera (player's side)

import * as THREE from 'three';

// ─── Court dimensions (metres) ───────────────────────────────────────────────
const COURT_LEN  = 23.77;  // full length
const COURT_W    = 8.23;   // singles width
const HALF_LEN   = COURT_LEN / 2;   // 11.885
const HALF_W     = COURT_W  / 2;    //  4.115
const SERVICE_D  = 6.40;   // distance from net to service line
const NET_H      = 0.914;  // net height at posts (slightly higher than centre)

// ─── Colours ──────────────────────────────────────────────────────────────────
const C_SURFACE  = 0x0d1f3c;  // deep navy-blue court
const C_LINE     = 0xd0e8ff;  // bright white-blue lines
const C_NET_POST = 0x555577;
const C_STAND    = 0x0a0a18;  // near-black crowd stands

export class Court {
  constructor() {
    this._group = new THREE.Group();
    this._build();
  }

  // Attach all court geometry to a Three.js scene (or any parent Object3D)
  addToScene(scene) {
    scene.add(this._group);
  }

  // Briefly flash the court lines to bright yellow-gold on a winning shot,
  // then restore them to the original white-blue after a short delay.
  flashLines() {
    if (!this._linesMat) return;
    this._linesMat.color.set(0xffe566);       // golden flash colour
    clearTimeout(this._lineFlashTimer);
    // Restore original colour after 350 ms — short enough to feel snappy
    this._lineFlashTimer = setTimeout(() => {
      this._linesMat.color.set(C_LINE);
    }, 350);
  }

  // ─── private ────────────────────────────────────────────────────────────────

  _build() {
    this._addSurface();
    this._addLines();
    this._addNet();
    this._addStands();
    this._addFloodlightGlow();
  }

  // Court surface — flat rectangle lying on Y = 0
  _addSurface() {
    const geo = new THREE.PlaneGeometry(COURT_W, COURT_LEN);
    const mat = new THREE.MeshStandardMaterial({
      color: C_SURFACE,
      roughness: 0.92,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this._group.add(mesh);

    // Subtle grid overlaid on the surface — gives the hard-court texture feel
    // The grid sits 0.001 units above the surface to avoid z-fighting
    const grid = new THREE.GridHelper(
      Math.max(COURT_W, COURT_LEN), // size
      46,                           // divisions ≈ 0.5 m cells
      0x162a50,                     // center line colour
      0x132040                      // grid line colour
    );
    grid.position.y = 0.001;
    this._group.add(grid);
  }

  // White court lines — built as LineSegments for zero geometry cost
  _addLines() {
    const pts = [];

    const ln = (x1, y1, z1, x2, y2, z2) => {
      pts.push(x1, y1, z1, x2, y2, z2);
    };

    const Y = 0.003; // slightly above surface

    // Baselines (far and near ends)
    ln(-HALF_W, Y,  HALF_LEN,  HALF_W, Y,  HALF_LEN);
    ln(-HALF_W, Y, -HALF_LEN,  HALF_W, Y, -HALF_LEN);

    // Sidelines (full length)
    ln(-HALF_W, Y, -HALF_LEN, -HALF_W, Y,  HALF_LEN);
    ln( HALF_W, Y, -HALF_LEN,  HALF_W, Y,  HALF_LEN);

    // Net line (at z = 0)
    ln(-HALF_W, Y, 0,  HALF_W, Y, 0);

    // Service lines (player side and opponent side)
    ln(-HALF_W, Y,  SERVICE_D,  HALF_W, Y,  SERVICE_D);
    ln(-HALF_W, Y, -SERVICE_D,  HALF_W, Y, -SERVICE_D);

    // Centre service line (connects the two service lines through the net)
    ln(0, Y, -SERVICE_D, 0, Y,  SERVICE_D);

    // Centre marks on baselines (0.1 m tick inward from each baseline)
    const TICK = 0.1;
    ln(0, Y,  HALF_LEN, 0, Y,  HALF_LEN - TICK);
    ln(0, Y, -HALF_LEN, 0, Y, -HALF_LEN + TICK);

    const positions = new Float32Array(pts);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Store reference so flashLines() can temporarily change the colour
    this._linesMat = new THREE.LineBasicMaterial({
      color: C_LINE,
      linewidth: 1, // >1 only works in WebGL1 on some drivers; keep at 1
    });

    const lines = new THREE.LineSegments(geo, this._linesMat);
    this._group.add(lines);
  }

  // Net — a semi-transparent plane with a grid-like shader effect
  _addNet() {
    // Net plane
    const geo = new THREE.PlaneGeometry(COURT_W + 1, NET_H, 12, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x99aacc,
      wireframe: true,       // grid look without a custom texture
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const net = new THREE.Mesh(geo, mat);
    net.position.set(0, NET_H / 2, 0);
    this._group.add(net);

    // Net tape (white strip along the top)
    const tapeGeo = new THREE.BoxGeometry(COURT_W + 1, 0.05, 0.04);
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, NET_H + 0.025, 0);
    this._group.add(tape);

    // Net posts (left and right)
    for (const side of [-1, 1]) {
      const postGeo = new THREE.CylinderGeometry(0.03, 0.03, NET_H + 0.15, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: C_NET_POST });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * (COURT_W / 2 + 0.5), NET_H / 2, 0);
      this._group.add(post);
    }
  }

  // Simple dark-box stand silhouettes behind both baselines and along both sides
  _addStands() {
    const mat = new THREE.MeshStandardMaterial({
      color: C_STAND,
      roughness: 1,
    });

    const addBox = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      this._group.add(mesh);
    };

    // Far end (opponent's stand)
    addBox(22, 5, 4, 0, 2.5, -HALF_LEN - 4);
    // Near end (player's stand — behind camera, just for reflections / ambience)
    addBox(22, 3, 3, 0, 1.5,  HALF_LEN + 3);
    // Side stands
    addBox(5, 4, COURT_LEN + 8, -(HALF_W + 4), 2, 0);
    addBox(5, 4, COURT_LEN + 8,   HALF_W + 4,  2, 0);
  }

  // Invisible emissive patches high above the side stands simulate floodlights
  // casting coloured light down onto the court
  _addFloodlightGlow() {
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2,
    });

    const positions = [
      [-HALF_W - 2, 9, -HALF_LEN * 0.5],
      [ HALF_W + 2, 9, -HALF_LEN * 0.5],
      [-HALF_W - 2, 9,  HALF_LEN * 0.5],
      [ HALF_W + 2, 9,  HALF_LEN * 0.5],
    ];

    for (const [x, y, z] of positions) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 8),
        glowMat
      );
      mesh.position.set(x, y, z);
      this._group.add(mesh);
    }
  }
}
