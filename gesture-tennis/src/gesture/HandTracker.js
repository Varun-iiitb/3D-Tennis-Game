// HandTracker — MediaPipe setup and webcam
// Wraps MediaPipe Hands + Camera utility into a single class.
// Consumers register an onLandmarks callback; it fires every frame
// with the raw 21-point landmark array (or null when no hand visible).
//
// NOTE: Hands, HAND_CONNECTIONS, and Camera are IIFE globals loaded via
// <script> tags in index.html — they do NOT have named ESM exports.

// Re-export the connection pairs constant for GestureOverlay.
// Value is read lazily at draw-time via window.HAND_CONNECTIONS.
export const HAND_CONNECTIONS = window.HAND_CONNECTIONS;

export class HandTracker {
  // onLandmarks: (landmarks: Array<{x,y,z}> | null) => void
  constructor({ onLandmarks } = {}) {
    this._onLandmarks = onLandmarks ?? (() => {});
    this._hands  = null;
    this._camera = null;
    // Hidden video element — Camera utility needs a real <video> node
    this._video  = this._createHiddenVideo();
  }

  // Boots MediaPipe and the webcam. Returns a Promise that resolves when
  // the first frame arrives, rejects on camera-permission denial.
  async start() {
    // window.Hands is set by the <script> tag in index.html
    this._hands = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });

    this._hands.setOptions({
      maxNumHands:            1,
      modelComplexity:        1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence:  0.5,
    });

    this._hands.onResults((results) => {
      // Fire with the first hand's landmarks, or null when none detected
      const landmarks =
        results.multiHandLandmarks?.length > 0
          ? results.multiHandLandmarks[0]
          : null;
      this._onLandmarks(landmarks);
    });

    // Camera utility drives the MediaPipe loop — it calls hands.send()
    // on each video frame so we never block the main thread manually.
    await this._startCamera();
  }

  stop() {
    this._camera?.stop();
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  _createHiddenVideo() {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    // Keep the raw feed invisible; the overlay canvas is the visible preview
    video.style.cssText =
      'position:fixed;bottom:16px;left:16px;width:200px;height:150px;' +
      'opacity:0;pointer-events:none;z-index:-1;transform:scaleX(-1);';
    document.body.appendChild(video);
    return video;
  }

  _startCamera() {
    return new Promise((resolve, reject) => {
      let resolved = false;

      // window.Camera is set by the camera_utils <script> tag
      this._camera = new window.Camera(this._video, {
        onFrame: async () => {
          // Send each video frame into MediaPipe — runs on the camera's RAF loop
          await this._hands.send({ image: this._video });
          if (!resolved) {
            resolved = true;
            resolve();
          }
        },
        width:  640,
        height: 480,
      });

      // Camera.start() returns a promise that rejects on permission denial
      this._camera.start().catch(reject);
    });
  }
}
