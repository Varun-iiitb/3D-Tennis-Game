// Renderer — Three.js scene, camera, lights, and render loop

import * as THREE from 'three';

// Fog density tuned so the far stand silhouettes fade into the dark sky
const FOG_COLOR  = 0x080820;
const FOG_NEAR   = 18;
const FOG_FAR    = 45;

// Orbiting light colours — purple + cyan give the neon-night aesthetic
const LIGHT_PURPLE = 0x8844ff;
const LIGHT_CYAN   = 0x00e5ff;

// Orbit radius and speed for the two coloured point lights
const ORBIT_RADIUS = 8;
const ORBIT_SPEED  = 0.0004; // radians per ms

export class Renderer {
  constructor(canvas) {
    this._canvas   = canvas;
    this._clock    = new THREE.Clock();
    this._animId   = null;
    this._onTick   = null; // external callback(deltaSeconds, elapsedSeconds)

    this._buildScene();
    this._buildCamera();
    this._buildRenderer();
    this._buildLights();
    this._bindResize();
  }

  get scene()  { return this._scene;  }
  get camera() { return this._camera; }

  // Register a per-frame callback that game logic can hook into.
  // callback: (delta: number, elapsed: number) => void
  setTickCallback(callback) { this._onTick = callback; }

  start() {
    if (this._animId !== null) return; // already running
    this._loop();
  }

  stop() {
    if (this._animId !== null) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  _buildScene() {
    this._scene = new THREE.Scene();
    // Slight blue-purple haze ties the sky to the neon court lights
    this._scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this._scene.background = new THREE.Color(FOG_COLOR);
  }

  _buildCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    // Baseline position: stand at the near end of the court, eyes at net height
    this._camera.position.set(0, 2.5, 7);
    this._camera.lookAt(0, 1.2, -10);
  }

  _buildRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.1;
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _buildLights() {
    // Soft fill so nothing is pitch black
    const ambient = new THREE.AmbientLight(0x1a1a3a, 2.5);
    this._scene.add(ambient);

    // Directional light from above-front casts court shadows
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(0, 12, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far  = 40;
    dirLight.shadow.camera.left = dirLight.shadow.camera.bottom = -14;
    dirLight.shadow.camera.right = dirLight.shadow.camera.top  =  14;
    this._scene.add(dirLight);

    // Two coloured point lights stored so _loop can animate them
    this._purpleLight = new THREE.PointLight(LIGHT_PURPLE, 3, 22);
    this._purpleLight.position.set(ORBIT_RADIUS, 5, 0);
    this._scene.add(this._purpleLight);

    this._cyanLight = new THREE.PointLight(LIGHT_CYAN, 3, 22);
    this._cyanLight.position.set(-ORBIT_RADIUS, 5, 0);
    this._scene.add(this._cyanLight);
  }

  _bindResize() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h);
    });
  }

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());

    const delta   = this._clock.getDelta();
    const elapsed = this._clock.getElapsedTime();

    // Orbit the two coloured point lights around the Y axis
    const angle = elapsed * ORBIT_SPEED * 1000; // convert ms-rate to seconds-rate
    this._purpleLight.position.set(
      Math.cos(angle)          * ORBIT_RADIUS, 5,
      Math.sin(angle)          * ORBIT_RADIUS * 0.4
    );
    this._cyanLight.position.set(
      Math.cos(angle + Math.PI) * ORBIT_RADIUS, 5,
      Math.sin(angle + Math.PI) * ORBIT_RADIUS * 0.4
    );

    this._onTick?.(delta, elapsed);
    this._renderer.render(this._scene, this._camera);
  }
}
