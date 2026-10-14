import type { SessionSnapshot } from "../../compute";
import type { CompiledObjectBinding } from "tikz-editor/edit/advanced-instrumentation";
import { apply, boundsDelta, calibrate, identity, mapBounds, multiply, union, type Affine, type Bounds, type Point } from "./geometry";

export type ComparisonRow = { id: string; label: string; line: number; fast?: Bounds; tex?: Bounds; fastText?: Bounds; texText?: Bounds;
  dimensions: ReturnType<typeof boundsDelta>; textDimensions: ReturnType<typeof boundsDelta>;
  anchors: { name: string; fast: Point; tex: Point; distance: number }[]; baseline: number | null; fontSizes: number[] };
export type ComparisonResult = { transform: Affine; viewBox: Bounds; rows: ComparisonRow[]; fastBody: string; texBody: string };

function rootPoint(element: SVGGraphicsElement, root: SVGSVGElement, point: Point): Point {
  const rootMatrix = root.getScreenCTM()?.inverse(), local = element.getScreenCTM();
  if (!rootMatrix || !local) throw new Error("无法读取 SVG 坐标，请重新对照。");
  return apply(rootMatrix.multiply(local), point);
}
function box(element: SVGGraphicsElement, root: SVGSVGElement, extra: Affine = identity): Bounds | null {
  try {
    const bounds = element.getBBox(), origin = root.getScreenCTM()?.inverse(), local = element.getScreenCTM();
    if (!origin || !local || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
    return mapBounds(multiply(extra, origin.multiply(local)), bounds);
  } catch { return null; }
}
function combine(elements: SVGGraphicsElement[], root: SVGSVGElement, matrix?: Affine): Bounds | undefined {
  return union(elements.map((element) => box(element, root, matrix)).filter((value): value is Bounds => value !== null)) ?? undefined;
}
/** Separate SVG namespaces so font paths, clips and gradients cannot cross-reference layers. */
function body(root: SVGSVGElement, prefix: string): string {
  const clone = root.cloneNode(true) as SVGSVGElement;
  const ids = new Set(Array.from(clone.querySelectorAll("[id]")).map((element) => element.id));
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") element.setAttribute("id", prefix + attribute.value);
      else if (["href", "xlink:href"].includes(attribute.name) && attribute.value.startsWith("#") && ids.has(attribute.value.slice(1))) element.setAttribute(attribute.name, "#" + prefix + attribute.value.slice(1));
      else if (attribute.value.includes("url(")) element.setAttribute(attribute.name, attribute.value.replace(/url\(['"]?#([^)'"\s]+)['"]?\)/gu, (_match, id: string) => `url(#${prefix}${id})`));
    }
  }
  for (const marker of Array.from(clone.querySelectorAll('circle[id^="tex-tb-"], circle[id^="fast-tb-"]'))) marker.remove();
  const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (const name of ["fill", "stroke", "stroke-width", "color", "opacity", "font-family", "font-size", "style"]) {
    const value = clone.getAttribute(name); if (value !== null) wrapper.setAttribute(name, value);
  }
  wrapper.innerHTML = clone.innerHTML;
  return wrapper.outerHTML;
}
export function measureComparison(fast: SVGSVGElement, tex: SVGSVGElement, snapshot: SessionSnapshot, bindings: readonly CompiledObjectBinding[]): ComparisonResult {
  const fastBox = snapshot.svg!.viewBox;
  const marker = (name: string): Point => {
    const circle = tex.querySelector<SVGCircleElement>(`#tb-world-${name}`);
    if (!circle) throw new Error("TeX 未返回世界坐标标记；不能用画面包围盒猜测对齐。");
    return rootPoint(circle, tex, { x: circle.cx.baseVal.value, y: circle.cy.baseVal.value });
  };
  const transform = calibrate(marker("basis0"), marker("basisx"), marker("basisy"), fastBox);
  const fastGroups = new Map<string, SVGGraphicsElement[]>();
  for (const element of Array.from(fast.querySelectorAll<SVGGraphicsElement>("[data-source-id]"))) {
    const id = element.getAttribute("data-source-id")!;
    const list = fastGroups.get(id) ?? []; list.push(element); fastGroups.set(id, list);
  }
  const bindingMap = new Map(bindings.map((binding) => [binding.id, binding]));
  const texIds = new Map(Array.from(tex.querySelectorAll<SVGGraphicsElement>("[id]")).map((element) => [element.id, element]));
  const texTextGroups = new Map<string, SVGGraphicsElement[]>();
  for (const [id, element] of texIds) {
    const match = /^tb-compare-text-(\d+)-\d+$/u.exec(id);
    if (!match) continue;
    const list = texTextGroups.get(match[1]) ?? []; list.push(element); texTextGroups.set(match[1], list);
  }
  const sceneBySource = new Map<string, NonNullable<SessionSnapshot["scene"]>["elements"]>();
  for (const element of snapshot.scene?.elements ?? []) {
    const id = element.sourceRef.sourceId; if (!id) continue;
    const list = sceneBySource.get(id) ?? []; list.push(element); sceneBySource.set(id, list);
  }
  const anchorsBySource = new Map<string, NonNullable<SessionSnapshot["semanticResult"]>["nodeAnchorTargets"]>();
  for (const target of snapshot.semanticResult?.nodeAnchorTargets ?? []) {
    if (!target.nodeSourceId) continue;
    const list = anchorsBySource.get(target.nodeSourceId) ?? []; list.push(target); anchorsBySource.set(target.nodeSourceId, list);
  }
  const ids = [...new Set([...bindingMap.keys(), ...fastGroups.keys()])];
  const flip = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * fastBox.y + fastBox.height };
  const rows = ids.map((id): ComparisonRow => {
    const binding = bindingMap.get(id), elements = fastGroups.get(id) ?? [];
    const texGroup = binding ? texIds.get(`tb-compare-object-${binding.key}`) ?? texIds.get(`tb-plot-${binding.key}`) : undefined;
    const fastBounds = combine(elements, fast), texBounds = texGroup ? box(texGroup, tex, transform) ?? undefined : undefined;
    const fastText = combine(elements.filter((element) => element.localName === "text" || element.hasAttribute("data-text-renderer")), fast);
    const texText = binding ? combine(texTextGroups.get(binding.key) ?? [], tex, transform) : undefined;
    const anchors: ComparisonRow["anchors"] = [];
    if (binding) for (const target of anchorsBySource.get(id) ?? []) {
      const circle = texIds.get(`tb-${binding.key}-${target.anchor.replaceAll(" ", "-")}`) as SVGCircleElement | undefined;
      if (!circle) continue;
      const first = apply(flip, target.world), second = apply(transform, rootPoint(circle, tex, { x: circle.cx.baseVal.value, y: circle.cy.baseVal.value }));
      anchors.push({ name: target.anchor, fast: first, tex: second, distance: Math.hypot(first.x - second.x, first.y - second.y) });
    }
    const textElements = (sceneBySource.get(id) ?? []).filter((element) => element.kind === "Text");
    const textElement = textElements.find((element) => element.kind === "Text" && element.baselineOffsetY !== undefined);
    const base = binding ? texIds.get(`tb-${binding.key}-base`) as SVGCircleElement | undefined : undefined;
    let baseline = anchors.find((anchor) => anchor.name === "base")?.distance ?? null;
    if (baseline === null && base && textElement?.kind === "Text" && textElement.baselineOffsetY !== undefined) {
      const radians = (textElement.rotation ?? 0) * Math.PI / 180;
      const point = { x: textElement.position.x - Math.sin(radians) * textElement.baselineOffsetY, y: textElement.position.y + Math.cos(radians) * textElement.baselineOffsetY };
      const first = apply(flip, apply(textElement.transform ?? identity, point));
      const second = apply(transform, rootPoint(base, tex, { x: base.cx.baseVal.value, y: base.cy.baseVal.value }));
      baseline = Math.hypot(first.x - second.x, first.y - second.y);
      anchors.push({ name: "base", fast: first, tex: second, distance: baseline });
    }
    const span = sceneBySource.get(id)?.[0]?.sourceRef.sourceSpan;
    const line = span ? snapshot.source.slice(0, span.from).split("\n").length : 0;
    return { id, label: textElements.map((element) => element.kind === "Text" ? element.text : "").join(" | ").slice(0, 50) || id, line,
      fast: fastBounds, tex: texBounds, fastText, texText, dimensions: boundsDelta(fastBounds, texBounds), textDimensions: boundsDelta(fastText, texText), anchors, baseline,
      fontSizes: [...new Set(textElements.map((element) => element.style.fontSize))] };
  });
  const texViewBox = tex.viewBox.baseVal;
  const texFrame = [texViewBox.x, texViewBox.y, texViewBox.width, texViewBox.height].every(Number.isFinite) && texViewBox.width > 0 && texViewBox.height > 0
    ? [mapBounds(transform, texViewBox)] : [];
  const boxUnion = union([fastBox, ...texFrame, ...rows.flatMap((row) => row.tex ? [row.tex] : [])])!;
  const margin = 8;
  return { transform, viewBox: { x: boxUnion.x - margin, y: boxUnion.y - margin, width: Math.max(1, boxUnion.width + margin * 2), height: Math.max(1, boxUnion.height + margin * 2) }, rows, fastBody: body(fast, "fast-"), texBody: body(tex, "tex-") };
}
