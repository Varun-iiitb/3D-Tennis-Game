// GestureOverlay — draws hand skeleton onto the small webcam preview canvas
// Uses MediaPipe drawing_utils globals (drawConnectors, drawLandmarks) loaded
// via <script> tag in index.html — they are NOT named ESM exports.

import { HAND_CONNECTIONS } from './HandTracker.js';

// Colours chosen to match the neon aesthetic (dark court, purple/pink accents)
const CONNECTOR_COLOR = 'rgba(160, 90, 255, 0.85)';  // purple
const LANDMARK_COLOR  = 'rgba(255, 100, 180, 0.95)';  // pink
const LANDMARK_FILL   = 'rgba(255, 100, 180, 0.3)';

export class GestureOverlay {
  // canvas — the small #webcam-preview <canvas> element (200×150)
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
  }

  // Called every hand-tracking frame.
  // landmarks: Array<{x,y,z}> in normalised [0,1] coords, or null.
  draw(landmarks) {
    const { _ctx: ctx, _canvas: canvas } = this;

    // Mirror the canvas context to match the CSS scaleX(-1) on the preview
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (landmarks) {
      // drawConnectors / drawLandmarks are registered on window by drawing_utils.js
      window.drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
        color:     CONNECTOR_COLOR,
        lineWidth: 2,
      });

      window.drawLandmarks(ctx, landmarks, {
        color:      LANDMARK_COLOR,
        fillColor:  LANDMARK_FILL,
        lineWidth:  1,
        radius:     3,
      });
    }

    ctx.restore();
  }
}
