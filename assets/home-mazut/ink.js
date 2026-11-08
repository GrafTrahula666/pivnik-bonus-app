// Use the same particle footprint as the canvas, without reading GPU pixels.
export function createMazutInk(canvas, elements, sampleInterval = 60) {
  const targets = [...elements];
  const sampleColumns = [.18, .34, .5, .66, .82];
  let lastSample = -Infinity;

  return function updateInk({ width, height, radius, x, y, oldX, oldY, blend }) {
    const now = performance.now();
    if (now - lastSample < sampleInterval) return;
    lastSample = now;
    const scene = canvas.getBoundingClientRect();
    if (!scene.width || !scene.height) return;
    const scaleX = width / scene.width;
    const scaleY = height / scene.height;
    const radiusSquared = radius * radius;

    function hasMazut(px, py) {
      let density = 0;
      for (let i = 0; i < x.length; i++) {
        const dx = oldX[i] + (x[i] - oldX[i]) * blend - px;
        const dy = oldY[i] + (y[i] - oldY[i]) * blend - py;
        const weight = 1 - (dx * dx + dy * dy) / radiusSquared;
        if (weight <= 0) continue;
        density += weight * weight * weight * .19;
        if (density >= .105) return true;
      }
      return false;
    }

    const boxes = targets.map((element) => element.getBoundingClientRect());
    for (const [index, element] of targets.entries()) {
      const box = boxes[index];
      const py = (box.top + box.height / 2 - scene.top) * scaleY;
      // A small dead zone keeps a moving edge from flickering between colors.
      const wasCovered = element.hasAttribute('data-mazut-over');
      const threshold = wasCovered ? 2 : 3;
      let covered = 0;
      if (box.width && box.height && py >= 0 && py < height) {
        for (const fraction of sampleColumns) {
          const px = (box.left + box.width * fraction - scene.left) * scaleX;
          if (px >= 0 && px < width && hasMazut(px, py)) covered++;
          if (covered >= threshold) break;
        }
      }
      element.toggleAttribute('data-mazut-over', covered >= threshold);
    }
  };
}
