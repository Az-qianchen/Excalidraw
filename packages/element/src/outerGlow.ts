import type { OuterGlow } from "./types";

/**
 * 外发光渲染核心。
 *
 * 软发光：基于元素 alpha 轮廓的多层模糊叠加，
 * 合成任意"从实到虚"的衰减曲线：
 *   glow(x) = Σ wᵢ · blurᵢ(silhouette)
 *   w(d) = (1 - d)^k，strength 控制 k（低=陡峭，高=平缓）
 * 适用于所有元素类型（形状/文字/图片/含半透明蒙版的抠图）。
 *
 * 硬边外扩（hardEdge=true）不在此实现：
 * 仅形状/线条/文字支持，由 renderElement 直接用原生
 * ctx.stroke()/strokeText() 精确矢量描边（见 drawElementOnCanvas 的
 * glow 分支）；图片等位图轮廓元素不支持硬边。
 */

/** 衰减曲线指数：strength 0 → 陡峭（k≈6），99 → 平缓（k≈0.15） */
const getCurveExponent = (strength: number) => {
  const s = Math.min(Math.max(strength, 0), 99) / 100;
  return 6 * Math.pow(1 - s, 1.5) + 0.15;
};

/** 归一化距离 d 处的衰减权重 */
const curveWeight = (exponent: number, d: number) => {
  return Math.pow(Math.max(0, 1 - d), exponent);
};

/** 多层模糊的层数 */
const TAPS = 6;

/**
 * 图片等位图轮廓元素的硬边外扩：多方向偏移膨胀。
 * 把 silhouette 的 alpha 轮廓向 16 个方向偏移 radius 叠加，
 * 再用发光颜色重新着色，形成实心外扩层（近似形态学 dilate）。
 *
 * pixelScale 为 silhouette 的像素缩放（交互渲染为 dpr × zoom，
 * 导出为 exportScale），膨胀半径需与之匹配。
 */
export const renderHardEdgeFromSilhouette = (
  target: CanvasRenderingContext2D,
  silhouette: HTMLCanvasElement,
  glow: OuterGlow,
  pixelScale: number,
) => {
  const r = glow.width * pixelScale;
  if (r <= 0) {
    return;
  }

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = silhouette.width + r * 2;
  glowCanvas.height = silhouette.height + r * 2;
  const gctx = glowCanvas.getContext("2d")!;

  // 16 方向偏移叠加近似圆形膨胀
  const offsets = 16;
  for (let i = 0; i < offsets; i++) {
    const angle = (i / offsets) * Math.PI * 2;
    gctx.drawImage(
      silhouette,
      r + Math.cos(angle) * r,
      r + Math.sin(angle) * r,
    );
  }
  // 中间多叠几遍把边缘填实
  for (let i = 0; i < 2; i++) {
    gctx.drawImage(silhouette, r, r);
  }

  // 用发光颜色重新着色（保留 alpha）：source-in 上色
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = glowCanvas.width;
  colorCanvas.height = glowCanvas.height;
  const cctx = colorCanvas.getContext("2d")!;
  cctx.drawImage(glowCanvas, 0, 0);
  cctx.globalCompositeOperation = "source-in";
  cctx.fillStyle = glow.color;
  cctx.fillRect(0, 0, colorCanvas.width, colorCanvas.height);

  target.drawImage(colorCanvas, -r, -r);
};

/**
 * 在 target 上合成软发光层（垫在主体之下，由调用方控制顺序）。
 * silhouette 是已绘制元素主体的离屏 canvas（含 alpha）。
 * pixelScale 为 silhouette 的像素缩放（交互渲染为 dpr × zoom，
 * 导出为 exportScale）。
 */
export const renderOuterGlow = (
  target: CanvasRenderingContext2D,
  silhouette: HTMLCanvasElement,
  glow: OuterGlow,
  pixelScale: number,
) => {
  const width = glow.width * pixelScale;
  if (width <= 0) {
    return;
  }

  const glowCanvas = document.createElement("canvas");
  // 光晕画布四周预留一个 width 的余量，避免模糊被裁
  glowCanvas.width = silhouette.width + width * 2;
  glowCanvas.height = silhouette.height + width * 2;
  const gctx = glowCanvas.getContext("2d")!;
  gctx.imageSmoothingEnabled = true;
  gctx.imageSmoothingQuality = "high";

  const exponent = getCurveExponent(glow.strength);
  gctx.save();
  for (let i = 1; i <= TAPS; i++) {
    const d = i / TAPS; // 归一化模糊半径（0=锐，1=最糊）
    const blur = width * d;
    // 权重应是衰减曲线在"距离"上的取值：模糊半径越大代表采样距离越远，
    // 权重越低（快速变虚）；最小的模糊层（贴边）权重最高（最"实"）
    const w = curveWeight(exponent, d);
    if (w <= 0.01) {
      continue;
    }
    gctx.globalAlpha = Math.min(1, w);
    gctx.filter = `blur(${blur}px)`;
    gctx.drawImage(silhouette, width, width);
  }
  gctx.restore();

  // 用发光颜色重新着色（保留 alpha）：source-in 上色
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = glowCanvas.width;
  colorCanvas.height = glowCanvas.height;
  const cctx = colorCanvas.getContext("2d")!;
  cctx.drawImage(glowCanvas, 0, 0);
  cctx.globalCompositeOperation = "source-in";
  cctx.fillStyle = glow.color;
  cctx.fillRect(0, 0, colorCanvas.width, colorCanvas.height);

  // 绘制到目标，位置与 silhouette 对齐（偏移 -width）
  target.drawImage(colorCanvas, -width, -width);
};
