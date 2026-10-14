export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
export const identity: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export function apply(matrix: Affine, point: Point): Point {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
}
export function multiply(left: Affine, right: Affine): Affine {
  return { a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f };
}
export function inverse(matrix: Affine): Affine {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Object.values(matrix).every(Number.isFinite) || Math.abs(det) < 1e-10) throw new Error("TeX 坐标标记无效，无法按真实尺寸对齐。");
  return { a: matrix.d / det, b: -matrix.b / det, c: -matrix.c / det, d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det, f: (matrix.b * matrix.e - matrix.a * matrix.f) / det };
}
/** Align by TeX's three world-coordinate markers, never by matching bounding boxes. */
export function calibrate(origin: Point, x: Point, y: Point, fastViewBox: Bounds): Affine {
  return multiply({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * fastViewBox.y + fastViewBox.height },
    inverse({ a: x.x - origin.x, b: x.y - origin.y, c: y.x - origin.x, d: y.y - origin.y, e: origin.x, f: origin.y }));
}
export function mapBounds(matrix: Affine, bounds: Bounds): Bounds {
  const corners = [bounds, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }].map((point) => apply(matrix, point));
  const xs = corners.map((point) => point.x), ys = corners.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function union(bounds: readonly Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((box) => box.x)), y = Math.min(...bounds.map((box) => box.y));
  return { x, y, width: Math.max(...bounds.map((box) => box.x + box.width)) - x, height: Math.max(...bounds.map((box) => box.y + box.height)) - y };
}
export function boundsDelta(fast?: Bounds, tex?: Bounds): { width: number; height: number; position: number } | null {
  if (!fast || !tex) return null;
  return { width: tex.width - fast.width, height: tex.height - fast.height,
    position: Math.hypot(tex.x + tex.width / 2 - fast.x - fast.width / 2, tex.y + tex.height / 2 - fast.y - fast.height / 2) };
}
export function matrixAttribute(matrix: Affine): string { return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`; }
