declare module "magic-wand-tool" {
  interface ImageData {
    data: Uint8Array;
    width: number;
    height: number;
    bytes: number;
  }

  interface Mask {
    data: Uint8Array;
    width: number;
    height: number;
    bounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
  }

  interface Contour {
    points: Array<{ x: number; y: number }>;
    inner: boolean;
  }

  const MagicWand: {
    floodFill(
      image: ImageData,
      x: number,
      y: number,
      colorThreshold: number,
    ): Mask | null;
    traceContours(mask: Mask): Contour[];
    simplifyContours(
      contours: Contour[],
      simplifyTolerance: number,
      maxPoints: number,
    ): Contour[];
  };

  export default MagicWand;
}
