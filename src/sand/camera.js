// View camera over the simulation buffer.
//
// Holds the top-left visible cell in BUFFER-cell space. Position is kept as a
// float so panning can accumulate sub-cell velocity smoothly, but rendering and
// input read `colX`/`colY` (floored to whole cells) so the view always lands on
// exact cell boundaries — this keeps blitting and the 1px gutter grid aligned
// without any sub-cell offset math.
//
// The camera is always clamped to the loaded buffer. Horizontal world-infinity
// (added later) is achieved by sliding the buffer underneath a camera that stays
// within it, not by letting the camera roam unbounded — so this stays unchanged.

export function createCamera() {
  let x = 0;
  let y = 0;
  let maxX = 0;
  let maxY = 0;

  const clampNow = () => {
    if (x < 0) x = 0;
    else if (x > maxX) x = maxX;
    if (y < 0) y = 0;
    else if (y > maxY) y = maxY;
  };

  return {
    // Allowed travel = buffer extent minus the visible window.
    setBounds(mx, my) {
      maxX = mx > 0 ? mx : 0;
      maxY = my > 0 ? my : 0;
      clampNow();
    },
    // Center the view within the current bounds.
    center() {
      x = maxX / 2;
      y = maxY / 2;
    },
    panBy(dx, dy) {
      x += dx;
      y += dy;
      clampNow();
    },
    set(nx, ny) {
      x = nx;
      y = ny;
      clampNow();
    },
    get x() { return x; },
    get y() { return y; },
    // Whole-cell top-left of the view, used by both render and input mapping.
    get colX() { return Math.floor(x); },
    get colY() { return Math.floor(y); },
  };
}
