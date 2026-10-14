import type { OuterGlow } from "@excalidraw/element/types";

/**
 * SVG 导出的外发光支持。
 *
 * 软发光：用多层 feGaussianBlur（不同 stdDeviation）+ feBlend 叠加
 * 还原与 canvas 侧一致的衰减曲线 w(d) = (1-d)^k；
 * 通过 feFlood + feComposite(in) 把 glow 重新着色为指定颜色。
 *
 * 硬边外扩：形状/文字直接复制主体节点并加粗 stroke；
 * 图片用 feMorphology dilate 膨胀 alpha 轮廓。
 *
 * SVG filter 的原始区域（filter region）默认会裁掉主体外 10% 的区域，
 * 因此所有 filter 都显式设置 x/y/width/height（含 glow.width 余量）。
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

/** 与 canvas 侧 outerGlow.ts 相同的衰减曲线指数 */
const getCurveExponent = (strength: number) => {
  const s = Math.min(Math.max(strength, 0), 99) / 100;
  return 6 * Math.pow(1 - s, 1.5) + 0.15;
};

const TAPS = 6;

/** 创建元素级的 SVG filter 定义（软发光）。
 *  返回 filter id；调用方将节点垫在主体之下并引用该 filter。 */
export const createSoftGlowFilter = (
  doc: Document,
  svgRoot: SVGElement,
  elementId: string,
  glow: OuterGlow,
): string => {
  const filterId = `outer-glow-${elementId}`;
  const filter = doc.createElementNS(SVG_NS, "filter");
  filter.id = filterId;
  // filter region：元素 bbox 相对单位，四周各扩一倍 bbox，
  // 确保任意尺寸元素的光晕不被裁切（相对单位无需预知 bbox 尺寸）
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");

  const r = glow.width;
  const exponent = getCurveExponent(glow.strength);

  // 多层 blur 叠加：每层用 feGaussianBlur 产生，权重经 feComponentTransfer 调 alpha
  const merge = doc.createElementNS(SVG_NS, "feMerge");
  for (let i = 1; i <= TAPS; i++) {
    const d = i / TAPS;
    const blur = r * d;
    // 权重 = 衰减曲线在距离 d 处的值：(1-d)^k
    // 模糊半径越大（采样越远）权重越低，贴边小模糊层权重最高。
    // 与 canvas 侧 outerGlow.ts 的 curveWeight(exponent, d) 完全一致。
    const w = Math.pow(Math.max(0, 1 - d), exponent);
    if (w <= 0.01) {
      continue;
    }
    // blur 层
    const blurFilter = doc.createElementNS(SVG_NS, "feGaussianBlur");
    blurFilter.setAttribute("stdDeviation", `${blur / 2}`);
    blurFilter.setAttribute("in", "SourceAlpha");
    blurFilter.setAttribute("result", `blur${i}`);

    // alpha 权重
    const transfer = doc.createElementNS(SVG_NS, "feComponentTransfer");
    transfer.setAttribute("in", `blur${i}`);
    transfer.setAttribute("result", `weighted${i}`);
    const funcA = doc.createElementNS(SVG_NS, "feFuncA");
    funcA.setAttribute("type", "linear");
    funcA.setAttribute("slope", `${Math.min(1, w)}`);
    transfer.appendChild(funcA);

    filter.appendChild(blurFilter);
    filter.appendChild(transfer);

    const mergeNode = doc.createElementNS(SVG_NS, "feMergeNode");
    mergeNode.setAttribute("in", `weighted${i}`);
    merge.appendChild(mergeNode);
  }
  filter.appendChild(merge);
  merge.setAttribute("result", "mergedGlow");

  // 着色：feFlood(glow.color) + feComposite in
  const flood = doc.createElementNS(SVG_NS, "feFlood");
  flood.setAttribute("flood-color", glow.color);
  flood.setAttribute("result", "glowColor");
  filter.appendChild(flood);

  const composite = doc.createElementNS(SVG_NS, "feComposite");
  composite.setAttribute("in", "glowColor");
  composite.setAttribute("in2", "mergedGlow");
  composite.setAttribute("operator", "in");
  composite.setAttribute("result", "coloredGlow");
  filter.appendChild(composite);

  svgRoot.appendChild(filter);
  return filterId;
};

/** 创建图片硬边外扩的 feMorphology filter */
export const createHardEdgeImageFilter = (
  doc: Document,
  svgRoot: SVGElement,
  elementId: string,
  glow: OuterGlow,
): string => {
  const filterId = `outer-glow-hard-${elementId}`;
  const filter = doc.createElementNS(SVG_NS, "filter");
  filter.id = filterId;
  // filter region：bbox 相对单位四周扩一倍，避免大元素被裁
  filter.setAttribute("x", "-50%");
  filter.setAttribute("y", "-50%");
  filter.setAttribute("width", "200%");
  filter.setAttribute("height", "200%");
  const r = glow.width;

  const morph = doc.createElementNS(SVG_NS, "feMorphology");
  morph.setAttribute("operator", "dilate");
  morph.setAttribute("radius", `${r}`);
  morph.setAttribute("in", "SourceAlpha");
  morph.setAttribute("result", "dilated");
  filter.appendChild(morph);

  const flood = doc.createElementNS(SVG_NS, "feFlood");
  flood.setAttribute("flood-color", glow.color);
  flood.setAttribute("result", "glowColor");
  filter.appendChild(flood);

  const composite = doc.createElementNS(SVG_NS, "feComposite");
  composite.setAttribute("in", "glowColor");
  composite.setAttribute("in2", "dilated");
  composite.setAttribute("operator", "in");
  filter.appendChild(composite);

  svgRoot.appendChild(filter);
  return filterId;
};
