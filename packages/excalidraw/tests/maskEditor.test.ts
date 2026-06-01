import { newImageElement } from "@excalidraw/element";
import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { GlobalPoint } from "@excalidraw/math";

import { MaskEditor } from "../mask-editor";

const globalPointFromPreviewLocal = (
  element: ExcalidrawImageElement,
  localX: number,
  localY: number,
): GlobalPoint => {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  let displayX = localX;
  let displayY = localY;

  if (element.scale[0] < 0) {
    displayX = element.width - displayX;
  }
  if (element.scale[1] < 0) {
    displayY = element.height - displayY;
  }

  return pointRotateRads(
    pointFrom<GlobalPoint>(element.x + displayX, element.y + displayY),
    pointFrom<GlobalPoint>(cx, cy),
    element.angle as Radians,
  );
};

describe("MaskEditor coordinate transforms", () => {
  it("keeps rotated preview path coordinates consistent with applyMask image coordinates", () => {
    const element = newImageElement({
      type: "image",
      x: 120,
      y: 80,
      width: 200,
      height: 100,
      angle: (Math.PI / 5) as Radians,
      scale: [1, 1],
    });

    const naturalWidth = 800;
    const naturalHeight = 400;
    const previewLocalPoints = [
      { x: 20, y: 10 },
      { x: 160, y: 15 },
      { x: 130, y: 80 },
      { x: 35, y: 75 },
    ];
    const maskingPoints = previewLocalPoints.map(({ x, y }) =>
      globalPointFromPreviewLocal(element, x, y),
    );

    const previewPathPoints = maskingPoints.map((point) =>
      MaskEditor.globalToElementLocalDisplay(point, element),
    );
    const applyMaskLocalPoints = maskingPoints.map((point) =>
      MaskEditor.globalToImageLocal(
        point,
        element,
        naturalWidth,
        naturalHeight,
      ),
    );

    previewPathPoints.forEach((previewPoint, index) => {
      expect(previewPoint.x).toBeCloseTo(previewLocalPoints[index].x);
      expect(previewPoint.y).toBeCloseTo(previewLocalPoints[index].y);
      expect(applyMaskLocalPoints[index].x).toBeCloseTo(
        (previewPoint.x / element.width) * naturalWidth,
      );
      expect(applyMaskLocalPoints[index].y).toBeCloseTo(
        (previewPoint.y / element.height) * naturalHeight,
      );
    });
  });

  it("mirrors preview path coordinates the same way as applyMask image coordinates", () => {
    const element = newImageElement({
      type: "image",
      x: -40,
      y: 30,
      width: 120,
      height: 90,
      angle: (Math.PI / 7) as Radians,
      scale: [-1, -1],
    });

    const naturalWidth = 360;
    const naturalHeight = 270;
    const previewLocalPoint = { x: 25, y: 60 };
    const maskingPoint = globalPointFromPreviewLocal(
      element,
      previewLocalPoint.x,
      previewLocalPoint.y,
    );

    const previewPoint = MaskEditor.globalToElementLocalDisplay(
      maskingPoint,
      element,
    );
    const applyMaskPoint = MaskEditor.globalToImageLocal(
      maskingPoint,
      element,
      naturalWidth,
      naturalHeight,
    );

    expect(previewPoint.x).toBeCloseTo(previewLocalPoint.x);
    expect(previewPoint.y).toBeCloseTo(previewLocalPoint.y);
    expect(applyMaskPoint.x).toBeCloseTo(
      (previewPoint.x / element.width) * naturalWidth,
    );
    expect(applyMaskPoint.y).toBeCloseTo(
      (previewPoint.y / element.height) * naturalHeight,
    );
  });
});
