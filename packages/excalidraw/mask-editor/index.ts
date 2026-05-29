import { pointFrom, pointDistance, pointRotateRads } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import type { BinaryFiles } from "../types";

export const MASK_POINT_HANDLE_SIZE = 10;
export const MASK_MIDPOINT_HANDLE_SIZE = 6;

export class MaskEditor {
  static tracePolygonPath(
    ctx: CanvasRenderingContext2D,
    points: readonly GlobalPoint[] | readonly { x: number; y: number }[],
    closePath = true,
  ): void {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = Array.isArray(p) ? (p as number[])[0] : (p as { x: number }).x;
      const y = Array.isArray(p) ? (p as number[])[1] : (p as { y: number }).y;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (closePath && points.length > 1) {
      ctx.closePath();
    }
  }

  static addPoint(
    points: readonly GlobalPoint[],
    point: GlobalPoint,
  ): GlobalPoint[] {
    return [...points, point];
  }

  static insertPoint(
    points: readonly GlobalPoint[],
    index: number,
    point: GlobalPoint,
  ): GlobalPoint[] {
    if (index < 0 || index > points.length) {
      return points as GlobalPoint[];
    }
    return [...points.slice(0, index), point, ...points.slice(index)];
  }

  static removeLastPoint(points: readonly GlobalPoint[]): GlobalPoint[] {
    if (points.length === 0) {
      return [];
    }
    return points.slice(0, -1);
  }

  static removePoint(
    points: readonly GlobalPoint[],
    index: number,
  ): GlobalPoint[] {
    if (index < 0 || index >= points.length) {
      return points as GlobalPoint[];
    }
    return [...points.slice(0, index), ...points.slice(index + 1)];
  }

  static movePoint(
    points: readonly GlobalPoint[],
    index: number,
    point: GlobalPoint,
  ): GlobalPoint[] {
    if (index < 0 || index >= points.length) {
      return points as GlobalPoint[];
    }
    const next = [...points];
    next[index] = point;
    return next;
  }

  static getPointUnderCursor(
    points: readonly GlobalPoint[],
    x: number,
    y: number,
    zoom: number,
  ): number {
    const cursorPoint = pointFrom<GlobalPoint>(x, y);
    for (let i = points.length - 1; i >= 0; i--) {
      const dist = pointDistance(points[i], cursorPoint) * zoom;
      if (dist < MASK_POINT_HANDLE_SIZE + 1) {
        return i;
      }
    }
    return -1;
  }

  static getMidpoints(
    points: readonly GlobalPoint[],
  ): { index: number; point: GlobalPoint }[] {
    if (points.length < 2) {
      return [];
    }
    const midpoints: { index: number; point: GlobalPoint }[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      const midX = (points[i][0] + points[next][0]) / 2;
      const midY = (points[i][1] + points[next][1]) / 2;
      midpoints.push({
        index: i + 1,
        point: pointFrom<GlobalPoint>(midX, midY),
      });
    }
    return midpoints;
  }

  static getMidpointUnderCursor(
    points: readonly GlobalPoint[],
    x: number,
    y: number,
    zoom: number,
  ): number {
    if (points.length < 2) {
      return -1;
    }
    const cursorPoint = pointFrom<GlobalPoint>(x, y);
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      const midX = (points[i][0] + points[next][0]) / 2;
      const midY = (points[i][1] + points[next][1]) / 2;
      const midPoint = pointFrom<GlobalPoint>(midX, midY);
      const dist = pointDistance(midPoint, cursorPoint) * zoom;
      if (dist < MASK_MIDPOINT_HANDLE_SIZE + 1) {
        return i + 1;
      }
    }
    return -1;
  }

  static globalToImageLocal(
    globalPoint: GlobalPoint,
    element: ExcalidrawImageElement,
    naturalWidth: number,
    naturalHeight: number,
  ): { x: number; y: number } {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;

    const rotated = pointRotateRads(
      globalPoint,
      pointFrom<GlobalPoint>(cx, cy),
      -element.angle as Radians,
    );

    let localX = rotated[0] - element.x;
    let localY = rotated[1] - element.y;

    if (element.scale[0] < 0) {
      localX = element.width - localX;
    }
    if (element.scale[1] < 0) {
      localY = element.height - localY;
    }

    const normalizedX = localX / element.width;
    const normalizedY = localY / element.height;

    let pixelX: number;
    let pixelY: number;

    if (element.crop) {
      pixelX = element.crop.x + normalizedX * element.crop.width;
      pixelY = element.crop.y + normalizedY * element.crop.height;
    } else {
      pixelX = normalizedX * naturalWidth;
      pixelY = normalizedY * naturalHeight;
    }

    return { x: pixelX, y: pixelY };
  }

  static async applyMask(
    element: ExcalidrawImageElement,
    maskPoints: readonly GlobalPoint[],
    maskingMode: "keepInside" | "keepOutside",
    files: BinaryFiles,
  ): Promise<{ dataURL: string; newWidth: number; newHeight: number } | null> {
    if (!element.fileId) {
      return null;
    }

    const fileData = files[element.fileId];
    if (!fileData) {
      return null;
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = fileData.dataURL;
    });

    // 裁剪区域（原图坐标）
    const crop = element.crop;
    const srcX = crop ? crop.x : 0;
    const srcY = crop ? crop.y : 0;
    const srcW = crop ? crop.width : img.naturalWidth;
    const srcH = crop ? crop.height : img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // 绘制裁剪后的图片
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    // 将遮罩点从原图坐标转换为裁剪画布坐标
    const localPoints = maskPoints.map((p) => {
      const imgLocal = MaskEditor.globalToImageLocal(
        p,
        element,
        img.naturalWidth,
        img.naturalHeight,
      );
      return { x: imgLocal.x - srcX, y: imgLocal.y - srcY };
    });

    ctx.globalCompositeOperation =
      maskingMode === "keepInside" ? "destination-in" : "destination-out";

    MaskEditor.tracePolygonPath(ctx, localPoints);
    ctx.fillStyle = "black";
    ctx.fill();

    const dataURL = canvas.toDataURL("image/png") as string;

    return {
      dataURL,
      newWidth: canvas.width,
      newHeight: canvas.height,
    };
  }
}
