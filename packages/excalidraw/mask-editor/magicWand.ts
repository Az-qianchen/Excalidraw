/**
 * 魔法抠图核心算法模块。
 * 基于 magic-wand-tool 库实现颜色选取、掩码操作与轮廓提取。
 */

import MagicWand from "magic-wand-tool";

/** 像素级掩码数据 */
export interface MagicWandMask {
  data: Uint8Array;
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** 矢量轮廓 */
export interface MagicWandContour {
  points: Array<{ x: number; y: number }>;
  inner: boolean;
}

/**
 * 从点击位置执行 flood fill，生成颜色掩码。
 * @param imageData 原始图像数据
 * @param x 点击位置 x 坐标（像素）
 * @param y 点击位置 y 坐标（像素）
 * @param threshold 颜色容差阈值，默认 20
 * @param contiguous 是否仅选取连续区域，默认 true
 */
export function floodFillMask(
  imageData: ImageData,
  x: number,
  y: number,
  threshold = 20,
  contiguous = true,
): MagicWandMask | null {
  const { width, height } = imageData;
  const src = new Uint8Array(imageData.data);

  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }

  if (contiguous) {
    const mask = MagicWand.floodFill(
      { data: src, width, height, bytes: 4 },
      x,
      y,
      threshold,
    );
    return mask ?? null;
  }

  // 非连续模式：全局匹配颜色
  const idx = (y * width + x) * 4;
  const tr = src[idx];
  const tg = src[idx + 1];
  const tb = src[idx + 2];
  const data = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      const dr = Math.abs(src[i] - tr);
      const dg = Math.abs(src[i + 1] - tg);
      const db = Math.abs(src[i + 2] - tb);
      if (dr <= threshold && dg <= threshold && db <= threshold) {
        const pos = py * width + px;
        data[pos] = 1;
        if (px < minX) {
          minX = px;
        }
        if (py < minY) {
          minY = py;
        }
        if (px > maxX) {
          maxX = px;
        }
        if (py > maxY) {
          maxY = py;
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { data, width, height, bounds: { minX, minY, maxX, maxY } };
}

/**
 * 将掩码应用到图像像素，使选区变为透明。
 * @param imageData 原始图像数据
 * @param mask 像素掩码
 * @param featherRadius 羽化半径，默认 0
 */
export function applyMaskToImage(
  imageData: ImageData,
  mask: MagicWandMask | null,
  featherRadius = 0,
): {
  image: ImageData;
  contours: MagicWandContour[];
} {
  const result = new Uint8ClampedArray(imageData.data);

  if (!mask) {
    return {
      image: new ImageData(result, imageData.width, imageData.height),
      contours: [],
    };
  }

  const effectiveRadius = Math.max(0, Math.floor(featherRadius));
  const featherData =
    effectiveRadius > 0 ? featherMask(mask, effectiveRadius) : null;

  for (let i = 0; i < mask.data.length; i++) {
    const strength = featherData ? featherData[i] : mask.data[i] ? 1 : 0;
    if (strength <= 0) {
      continue;
    }
    const alphaIndex = i * 4 + 3;
    const normalized = Math.max(0, Math.min(1, strength));
    result[alphaIndex] = Math.round(result[alphaIndex] * (1 - normalized));
  }

  const contours = traceMaskContours(mask);

  return {
    image: new ImageData(result, imageData.width, imageData.height),
    contours,
  };
}

/**
 * 反转掩码（选区内外互换）。
 */
export function invertMask(mask: MagicWandMask | null): MagicWandMask | null {
  if (!mask) {
    return null;
  }

  const { width, height, data } = mask;
  const length = width * height;
  const nextData = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    nextData[i] = data[i] ? 0 : 1;
  }

  const bounds = computeMaskBounds(nextData, width, height);
  if (!bounds) {
    return null;
  }

  return { data: nextData, width, height, bounds };
}

/**
 * 从掩码提取矢量轮廓并简化。
 */
export function traceMaskContours(
  mask: MagicWandMask | null,
): MagicWandContour[] {
  if (!mask) {
    return [];
  }

  try {
    const traced = MagicWand.traceContours(mask);
    return MagicWand.simplifyContours(traced, 0, 30);
  } catch (error) {
    console.warn("Failed to trace magic wand contours", error);
    return [];
  }
}

/** 计算掩码中非零像素的边界框 */
function computeMaskBounds(
  data: Uint8Array,
  width: number,
  height: number,
): MagicWandMask["bounds"] | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (data[idx]) {
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/** 羽化掩码边缘（高斯模糊近似） */
function featherMask(mask: MagicWandMask, radius: number): Float32Array {
  const { width, height, data } = mask;
  const total = width * height;
  const base = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    base[i] = data[i] ? 1 : 0;
  }

  const effectiveRadius = Math.max(0, Math.floor(radius));
  if (effectiveRadius === 0) {
    return base;
  }

  return boxBlurFloat32(base, width, height, effectiveRadius);
}

/** 两次 Box Blur 近似高斯模糊 */
function boxBlurFloat32(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const kernelSize = radius * 2 + 1;
  const horizontal = new Float32Array(width * height);
  const output = new Float32Array(width * height);

  // 水平方向
  const sampleRow = (rowOffset: number, x: number) => {
    const clamped = Math.min(width - 1, Math.max(0, x));
    return data[rowOffset + clamped];
  };
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += sampleRow(rowOffset, x);
    }
    horizontal[rowOffset] = sum / kernelSize;
    for (let x = 1; x < width; x++) {
      const addIndex = x + radius;
      const removeIndex = x - radius - 1;
      sum += sampleRow(rowOffset, addIndex) - sampleRow(rowOffset, removeIndex);
      horizontal[rowOffset + x] = sum / kernelSize;
    }
  }

  // 垂直方向
  const sampleColumn = (x: number, y: number) => {
    const clamped = Math.min(height - 1, Math.max(0, y));
    return horizontal[clamped * width + x];
  };
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += sampleColumn(x, y);
    }
    output[x] = sum / kernelSize;
    for (let y = 1; y < height; y++) {
      const addIndex = y + radius;
      const removeIndex = y - radius - 1;
      sum += sampleColumn(x, addIndex) - sampleColumn(x, removeIndex);
      output[y * width + x] = sum / kernelSize;
    }
  }

  return output;
}
