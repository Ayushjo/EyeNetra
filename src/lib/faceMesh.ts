/**
 * Delaunay triangulation (Bowyer–Watson) for the face-mesh occluder.
 *
 * MediaPipe's tasks-vision ships FACE_LANDMARKS_TESSELATION as edges only, not
 * triangles. Rather than depend on the exact canonical triangle list, we
 * triangulate the 468 landmark points ONCE (topology is fixed — landmark i is
 * always the same face point) and reuse the index list every frame, only
 * updating vertex depths. That makes the occluder self-contained and correct
 * for any face, and it is completely independent of which glasses frame is
 * selected, so it works for every frame added to the catalog.
 */

export type P2 = { x: number; y: number };

type Tri = [number, number, number];

function circumcircleContains(
  pts: P2[],
  tri: Tri,
  px: number,
  py: number,
): boolean {
  const [i, j, k] = tri;
  const ax = pts[i].x;
  const ay = pts[i].y;
  const bx = pts[j].x;
  const by = pts[j].y;
  const cx = pts[k].x;
  const cy = pts[k].y;

  const ab = ax * ax + ay * ay;
  const cd = bx * bx + by * by;
  const ef = cx * cx + cy * cy;

  const ax_ = ax - px;
  const ay_ = ay - py;
  const bx_ = bx - px;
  const by_ = by - py;
  const cx_ = cx - px;
  const cy_ = cy - py;

  // Determinant of the in-circle test matrix (points in CCW order assumed).
  const det =
    (ax_ * ax_ + ay_ * ay_) * (bx_ * cy_ - cx_ * by_) -
    (bx_ * bx_ + by_ * by_) * (ax_ * cy_ - cx_ * ay_) +
    (cx_ * cx_ + cy_ * cy_) * (ax_ * by_ - bx_ * ay_);
  // Orientation of the triangle.
  const orient =
    (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  void ab;
  void cd;
  void ef;
  // If CW, flip sign so the test is orientation-independent.
  return orient > 0 ? det > 0 : det < 0;
}

/**
 * Returns a flat index array (triples) triangulating `points`.
 * Indices refer into the original `points` array.
 */
export function delaunay(points: P2[]): number[] {
  const n = points.length;
  if (n < 3) return [];

  // Super-triangle enclosing all points.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy) * 20;
  const midx = (minX + maxX) / 2;
  const midy = (minY + maxY) / 2;

  // Working point list with 3 super vertices appended.
  const pts: P2[] = points.slice();
  const s0 = n;
  const s1 = n + 1;
  const s2 = n + 2;
  pts.push({ x: midx - dmax, y: midy - dmax });
  pts.push({ x: midx, y: midy + dmax });
  pts.push({ x: midx + dmax, y: midy - dmax });

  let tris: Tri[] = [[s0, s1, s2]];

  for (let ip = 0; ip < n; ip++) {
    const px = pts[ip].x;
    const py = pts[ip].y;

    const bad: Tri[] = [];
    const good: Tri[] = [];
    for (const t of tris) {
      if (circumcircleContains(pts, t, px, py)) bad.push(t);
      else good.push(t);
    }

    // Boundary of the polygonal hole = edges not shared by two bad triangles.
    const edgeCount = new Map<string, [number, number, number]>();
    for (const t of bad) {
      const es: [number, number][] = [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ];
      for (const [a, b] of es) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const prev = edgeCount.get(key);
        if (prev) prev[2] += 1;
        else edgeCount.set(key, [a, b, 1]);
      }
    }

    tris = good;
    for (const [, [a, b, count]] of edgeCount) {
      if (count === 1) tris.push([a, b, ip]);
    }
  }

  // Drop triangles touching the super-triangle.
  const out: number[] = [];
  for (const t of tris) {
    if (t[0] >= n || t[1] >= n || t[2] >= n) continue;
    out.push(t[0], t[1], t[2]);
  }
  return out;
}
