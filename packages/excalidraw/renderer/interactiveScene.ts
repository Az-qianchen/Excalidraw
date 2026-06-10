import {
  clamp,
  pointFrom,
  pointsEqual,
  type GlobalPoint,
  type LocalPoint,
  type Radians,
  bezierEquation,
  pointRotateRads,
  pointDistance,
} from "@excalidraw/math";

import {
  arrayToMap,
  BIND_MODE_TIMEOUT,
  DEFAULT_TRANSFORM_HANDLE_SPACING,
  FRAME_STYLE,
  getFeatureFlag,
  invariant,
  THEME,
} from "@excalidraw/common";

import {
  deconstructDiamondElement,
  deconstructRectanguloidElement,
  elementCenterPoint,
  getDiamondBaseCorners,
  FOCUS_POINT_SIZE,
  getOmitSidesForEditorInterface,
  getTransformHandles,
  getTransformHandlesFromCoords,
  hasBoundingBox,
  hitElementItself,
  isArrowElement,
  isBindableElement,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isLinearElement,
  isLineElement,
  maxBindingDistance_simple,
  isTextElement,
  LinearElementEditor,
  getActiveTextElement,
} from "@excalidraw/element";

import { renderSelectionElement } from "@excalidraw/element";

import {
  getElementsInGroup,
  getSelectedGroupIds,
  isSelectedViaGroup,
  selectGroupsFromGivenElements,
} from "@excalidraw/element";

import { getCommonBounds, getElementAbsoluteCoords } from "@excalidraw/element";
import {
  getGlobalFixedPointForBindableElement,
  isFocusPointVisible,
} from "@excalidraw/element";

import type { EditorInterface } from "@excalidraw/common";

import type {
  TransformHandles,
  TransformHandleType,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  GroupId,
  NonDeleted,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { renderSnaps } from "../renderer/renderSnaps";
import { roundRect } from "../renderer/roundRect";
import {
  getScrollBars,
  SCROLLBAR_COLOR,
  SCROLLBAR_WIDTH,
} from "../scene/scrollbars";

import { getClientColor, renderRemoteCursors } from "../clients";
import {
  getTextAutoResizeHandle,
  getTextBoxPadding,
} from "../textAutoResizeHandle";
import { MaskEditor, MASK_MIDPOINT_HANDLE_SIZE } from "../mask-editor";
import type { MagicWandMask, MagicWandContour } from "../mask-editor/magicWand";

import {
  bootstrapCanvas,
  fillCircle,
  getNormalizedCanvasDimensions,
  strokeRectWithRotation_simple,
} from "./helpers";

import type {
  AppState,
  AppClassProperties,
  InteractiveCanvasAppState,
} from "../types";
import type {
  InteractiveCanvasRenderConfig,
  InteractiveSceneRenderConfig,
  RenderableElementsMap,
} from "../scene/types";

const renderElbowArrowMidPointHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  invariant(appState.selectedLinearElement, "selectedLinearElement is null");

  const { segmentMidPointHoveredCoords } = appState.selectedLinearElement;

  invariant(segmentMidPointHoveredCoords, "midPointCoords is null");

  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  highlightPoint(segmentMidPointHoveredCoords, context, appState);

  context.restore();
};

const renderLinearElementPointHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap: ElementsMap,
) => {
  const { elementId, hoverPointIndex } = appState.selectedLinearElement!;
  if (
    appState.selectedLinearElement?.isEditing &&
    appState.selectedLinearElement?.selectedPointsIndices?.includes(
      hoverPointIndex,
    )
  ) {
    return;
  }
  if (appState.selectedLinearElement?.isDragging) {
    return;
  }
  const element = LinearElementEditor.getElement(elementId, elementsMap);

  if (!element) {
    return;
  }
  const point = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element,
    hoverPointIndex,
    elementsMap,
  );
  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  highlightPoint(point, context, appState);
  context.restore();
};

const highlightPoint = <Point extends LocalPoint | GlobalPoint>(
  point: Point,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  context.fillStyle = "rgba(105, 101, 219, 0.4)";

  fillCircle(
    context,
    point[0],
    point[1],
    LinearElementEditor.POINT_HANDLE_SIZE / appState.zoom.value,
    false,
  );
};

const renderFocusPointHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  focusPoint: GlobalPoint,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  highlightPoint(focusPoint, context, appState);

  context.restore();
};

const renderSingleLinearPoint = <Point extends GlobalPoint | LocalPoint>(
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  point: Point,
  radius: number,
  isSelected: boolean,
  isPhantomPoint: boolean,
  isOverlappingPoint: boolean,
) => {
  context.strokeStyle = "#5e5ad8";
  context.setLineDash([]);
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  if (isSelected) {
    context.fillStyle = "rgba(134, 131, 226, 0.9)";
  } else if (isPhantomPoint) {
    context.fillStyle = "rgba(177, 151, 252, 0.7)";
  }

  fillCircle(
    context,
    point[0],
    point[1],
    (isOverlappingPoint
      ? radius * (appState.selectedLinearElement?.isEditing ? 1.5 : 2)
      : radius) / appState.zoom.value,
    !isPhantomPoint,
    !isOverlappingPoint || isSelected,
  );
};

const renderBindingHighlightForBindableElement_simple = (
  context: CanvasRenderingContext2D,
  suggestedBinding: NonNullable<AppState["suggestedBinding"]>,
  elementsMap: ElementsMap,
  appState: InteractiveCanvasAppState,
  pointerCoords: GlobalPoint | null,
) => {
  const enclosingFrame =
    suggestedBinding.element.frameId &&
    elementsMap.get(suggestedBinding.element.frameId);
  if (enclosingFrame && isFrameLikeElement(enclosingFrame)) {
    context.translate(enclosingFrame.x, enclosingFrame.y);

    context.beginPath();

    if (FRAME_STYLE.radius && context.roundRect) {
      context.roundRect(
        -1,
        -1,
        enclosingFrame.width + 1,
        enclosingFrame.height + 1,
        FRAME_STYLE.radius / appState.zoom.value,
      );
    } else {
      context.rect(-1, -1, enclosingFrame.width + 1, enclosingFrame.height + 1);
    }

    context.clip();

    context.translate(-enclosingFrame.x, -enclosingFrame.y);
  }

  switch (suggestedBinding.element.type) {
    case "magicframe":
    case "frame":
      context.save();

      context.translate(suggestedBinding.element.x, suggestedBinding.element.y);

      context.lineWidth = FRAME_STYLE.strokeWidth / appState.zoom.value;
      context.strokeStyle =
        appState.theme === THEME.DARK
          ? `rgba(3, 93, 161, 1)`
          : `rgba(106, 189, 252, 1)`;

      if (FRAME_STYLE.radius && context.roundRect) {
        context.beginPath();
        context.roundRect(
          0,
          0,
          suggestedBinding.element.width,
          suggestedBinding.element.height,
          FRAME_STYLE.radius / appState.zoom.value,
        );
        context.stroke();
        context.closePath();
      } else {
        context.strokeRect(
          0,
          0,
          suggestedBinding.element.width,
          suggestedBinding.element.height,
        );
      }

      context.restore();
      break;
    default:
      context.save();

      const center = elementCenterPoint(suggestedBinding.element, elementsMap);

      context.translate(center[0], center[1]);
      context.rotate(suggestedBinding.element.angle as Radians);
      context.translate(-center[0], -center[1]);

      context.translate(suggestedBinding.element.x, suggestedBinding.element.y);

      context.lineWidth =
        clamp(1.75, suggestedBinding.element.strokeWidth, 4) /
        Math.max(0.25, appState.zoom.value);
      context.strokeStyle =
        appState.theme === THEME.DARK
          ? `rgba(3, 93, 161, 1)`
          : `rgba(106, 189, 252, 1)`;

      switch (suggestedBinding.element.type) {
        case "ellipse":
          context.beginPath();
          context.ellipse(
            suggestedBinding.element.width / 2,
            suggestedBinding.element.height / 2,
            suggestedBinding.element.width / 2,
            suggestedBinding.element.height / 2,
            0,
            0,
            2 * Math.PI,
          );
          context.closePath();
          context.stroke();
          break;
        case "diamond":
          {
            const [segments, curves] = deconstructDiamondElement(
              suggestedBinding.element,
            );

            // Draw each line segment individually
            segments.forEach((segment) => {
              context.beginPath();
              context.moveTo(
                segment[0][0] - suggestedBinding.element.x,
                segment[0][1] - suggestedBinding.element.y,
              );
              context.lineTo(
                segment[1][0] - suggestedBinding.element.x,
                segment[1][1] - suggestedBinding.element.y,
              );
              context.stroke();
            });

            // Draw each curve individually (for rounded corners)
            curves.forEach((curve) => {
              const [start, control1, control2, end] = curve;
              context.beginPath();
              context.moveTo(
                start[0] - suggestedBinding.element.x,
                start[1] - suggestedBinding.element.y,
              );
              context.bezierCurveTo(
                control1[0] - suggestedBinding.element.x,
                control1[1] - suggestedBinding.element.y,
                control2[0] - suggestedBinding.element.x,
                control2[1] - suggestedBinding.element.y,
                end[0] - suggestedBinding.element.x,
                end[1] - suggestedBinding.element.y,
              );
              context.stroke();
            });
          }

          break;
        default:
          {
            const [segments, curves] = deconstructRectanguloidElement(
              suggestedBinding.element,
            );

            // Draw each line segment individually
            segments.forEach((segment) => {
              context.beginPath();
              context.moveTo(
                segment[0][0] - suggestedBinding.element.x,
                segment[0][1] - suggestedBinding.element.y,
              );
              context.lineTo(
                segment[1][0] - suggestedBinding.element.x,
                segment[1][1] - suggestedBinding.element.y,
              );
              context.stroke();
            });

            // Draw each curve individually (for rounded corners)
            curves.forEach((curve) => {
              const [start, control1, control2, end] = curve;
              context.beginPath();
              context.moveTo(
                start[0] - suggestedBinding.element.x,
                start[1] - suggestedBinding.element.y,
              );
              context.bezierCurveTo(
                control1[0] - suggestedBinding.element.x,
                control1[1] - suggestedBinding.element.y,
                control2[0] - suggestedBinding.element.x,
                control2[1] - suggestedBinding.element.y,
                end[0] - suggestedBinding.element.x,
                end[1] - suggestedBinding.element.y,
              );
              context.stroke();
            });
          }

          break;
      }

      context.restore();

      break;
  }

  if (
    appState.isMidpointSnappingEnabled &&
    (isFrameLikeElement(suggestedBinding.element) ||
      isBindableElement(suggestedBinding.element))
  ) {
    // Draw midpoint indicators
    const linearElement = appState.selectedLinearElement;
    const arrow =
      linearElement?.elementId &&
      LinearElementEditor.getElement(linearElement?.elementId, elementsMap);
    const cursorIsInsideBindable =
      pointerCoords &&
      hitElementItself({
        point: pointerCoords,
        element: suggestedBinding.element,
        elementsMap,
        threshold: 0,
        overrideShouldTestInside: true,
      });

    const isElbow =
      (arrow && isElbowArrow(arrow)) ||
      (appState.activeTool.type === "arrow" &&
        appState.currentItemArrowType === "elbow");

    if (!cursorIsInsideBindable || isElbow) {
      context.save();

      const center = elementCenterPoint(suggestedBinding.element, elementsMap);

      let midpoints: GlobalPoint[];
      if (suggestedBinding.element.type === "diamond") {
        const center = elementCenterPoint(
          suggestedBinding.element,
          elementsMap,
        );
        midpoints = getDiamondBaseCorners(suggestedBinding.element).map(
          (curve) => {
            const point = bezierEquation(curve, 0.5);
            const rotatedPoint = pointRotateRads(
              point,
              center,
              suggestedBinding.element.angle,
            );

            return pointFrom<GlobalPoint>(rotatedPoint[0], rotatedPoint[1]);
          },
        );
      } else {
        const basePoints = [
          {
            x: suggestedBinding.element.width,
            y: suggestedBinding.element.height / 2,
          }, // RIGHT
          {
            x: suggestedBinding.element.width / 2,
            y: suggestedBinding.element.height,
          }, // BOTTOM
          { x: 0, y: suggestedBinding.element.height / 2 }, // LEFT
          { x: suggestedBinding.element.width / 2, y: 0 }, // TOP
        ];
        midpoints = basePoints.map((point) => {
          const globalPoint = pointFrom<GlobalPoint>(
            point.x + suggestedBinding.element.x,
            point.y + suggestedBinding.element.y,
          );
          const rotatedPoint = pointRotateRads(
            globalPoint,
            center,
            suggestedBinding.element.angle,
          );
          return pointFrom<GlobalPoint>(rotatedPoint[0], rotatedPoint[1]);
        });
      }

      const hoveredMidpoint =
        pointerCoords &&
        midpoints.reduce(
          (
            closestIdx: {
              idx: number;
              distance: number;
            },
            point,
            idx,
          ) => {
            const distance = pointDistance(point, pointerCoords);
            if (idx === -1 || distance < closestIdx.distance) {
              return { idx, distance };
            }
            return closestIdx;
          },
          {
            idx: -1,
            distance: Infinity,
          },
        );

      const midpointRadius = 4 / appState.zoom.value;
      const highlightThreshold =
        maxBindingDistance_simple(appState.zoom) +
        suggestedBinding.element.strokeWidth / 2;

      midpoints.forEach((midpoint, idx) => {
        const isHighlighted =
          (!cursorIsInsideBindable || isElbow) &&
          hoveredMidpoint?.idx === idx &&
          hoveredMidpoint.distance <= highlightThreshold;

        // also render midpoint if cursor close but not highlighted
        // (for elbows, always show all points)
        const isShown =
          !isHighlighted &&
          (isElbow ||
            (idx === hoveredMidpoint?.idx &&
              hoveredMidpoint.distance <= highlightThreshold * 2));

        if (isHighlighted) {
          context.fillStyle =
            appState.theme === THEME.DARK
              ? `rgba(3, 93, 161, 1)`
              : `rgba(106, 189, 252, 1)`;

          context.beginPath();
          context.arc(midpoint[0], midpoint[1], midpointRadius, 0, 2 * Math.PI);
          context.fill();
        } else if (isShown) {
          context.fillStyle =
            appState.theme === THEME.DARK
              ? `rgba(0, 0, 0, 0.8)`
              : `rgba(65, 65, 65, 0.5)`;
          context.beginPath();
          context.arc(midpoint[0], midpoint[1], midpointRadius, 0, 2 * Math.PI);
          context.fill();
        }
      });

      context.restore();
    }
  }
};

const renderBindingHighlightForBindableElement_complex = (
  app: AppClassProperties,
  context: CanvasRenderingContext2D,
  element: ExcalidrawBindableElement,
  allElementsMap: NonDeletedSceneElementsMap,
  appState: InteractiveCanvasAppState,
  deltaTime: number,
  state?: { runtime: number },
) => {
  const countdownInProgress =
    app.state.bindMode === "orbit" && app.bindModeHandler !== null;

  const remainingTime =
    BIND_MODE_TIMEOUT -
    (state?.runtime ?? (countdownInProgress ? 0 : BIND_MODE_TIMEOUT));
  const opacity = clamp((1 / BIND_MODE_TIMEOUT) * remainingTime, 0.0001, 1);
  const offset = element.strokeWidth / 2;

  const enclosingFrame = element.frameId && allElementsMap.get(element.frameId);
  if (enclosingFrame && isFrameLikeElement(enclosingFrame)) {
    context.translate(enclosingFrame.x, enclosingFrame.y);

    context.beginPath();

    if (FRAME_STYLE.radius && context.roundRect) {
      context.roundRect(
        -1,
        -1,
        enclosingFrame.width + 1,
        enclosingFrame.height + 1,
        FRAME_STYLE.radius / appState.zoom.value,
      );
    } else {
      context.rect(-1, -1, enclosingFrame.width + 1, enclosingFrame.height + 1);
    }

    context.clip();

    context.translate(-enclosingFrame.x, -enclosingFrame.y);
  }

  switch (element.type) {
    case "magicframe":
    case "frame":
      context.save();

      context.translate(element.x, element.y);

      context.lineWidth = FRAME_STYLE.strokeWidth / appState.zoom.value;
      context.strokeStyle =
        appState.theme === THEME.DARK
          ? `rgba(3, 93, 161, ${opacity})`
          : `rgba(106, 189, 252, ${opacity})`;

      if (FRAME_STYLE.radius && context.roundRect) {
        context.beginPath();
        context.roundRect(
          0,
          0,
          element.width,
          element.height,
          FRAME_STYLE.radius / appState.zoom.value,
        );
        context.stroke();
        context.closePath();
      } else {
        context.strokeRect(0, 0, element.width, element.height);
      }

      context.restore();
      break;
    default:
      context.save();

      const center = elementCenterPoint(element, allElementsMap);
      const cx = center[0] + appState.scrollX;
      const cy = center[1] + appState.scrollY;

      context.translate(cx, cy);
      context.rotate(element.angle as Radians);
      context.translate(-cx, -cy);

      context.translate(
        element.x + appState.scrollX - offset,
        element.y + appState.scrollY - offset,
      );

      context.lineWidth =
        clamp(2.5, element.strokeWidth * 1.75, 4) /
        Math.max(0.25, appState.zoom.value);
      context.strokeStyle =
        appState.theme === THEME.DARK
          ? `rgba(3, 93, 161, ${opacity / 2})`
          : `rgba(106, 189, 252, ${opacity / 2})`;

      switch (element.type) {
        case "ellipse":
          context.beginPath();
          context.ellipse(
            (element.width + offset * 2) / 2,
            (element.height + offset * 2) / 2,
            (element.width + offset * 2) / 2,
            (element.height + offset * 2) / 2,
            0,
            0,
            2 * Math.PI,
          );
          context.closePath();
          context.stroke();
          break;
        case "diamond":
          {
            const [segments, curves] = deconstructDiamondElement(
              element,
              offset,
            );

            // Draw each line segment individually
            segments.forEach((segment) => {
              context.beginPath();
              context.moveTo(
                segment[0][0] - element.x + offset,
                segment[0][1] - element.y + offset,
              );
              context.lineTo(
                segment[1][0] - element.x + offset,
                segment[1][1] - element.y + offset,
              );
              context.stroke();
            });

            // Draw each curve individually (for rounded corners)
            curves.forEach((curve) => {
              const [start, control1, control2, end] = curve;
              context.beginPath();
              context.moveTo(
                start[0] - element.x + offset,
                start[1] - element.y + offset,
              );
              context.bezierCurveTo(
                control1[0] - element.x + offset,
                control1[1] - element.y + offset,
                control2[0] - element.x + offset,
                control2[1] - element.y + offset,
                end[0] - element.x + offset,
                end[1] - element.y + offset,
              );
              context.stroke();
            });
          }

          break;
        default:
          {
            const [segments, curves] = deconstructRectanguloidElement(
              element,
              offset,
            );

            // Draw each line segment individually
            segments.forEach((segment) => {
              context.beginPath();
              context.moveTo(
                segment[0][0] - element.x + offset,
                segment[0][1] - element.y + offset,
              );
              context.lineTo(
                segment[1][0] - element.x + offset,
                segment[1][1] - element.y + offset,
              );
              context.stroke();
            });

            // Draw each curve individually (for rounded corners)
            curves.forEach((curve) => {
              const [start, control1, control2, end] = curve;
              context.beginPath();
              context.moveTo(
                start[0] - element.x + offset,
                start[1] - element.y + offset,
              );
              context.bezierCurveTo(
                control1[0] - element.x + offset,
                control1[1] - element.y + offset,
                control2[0] - element.x + offset,
                control2[1] - element.y + offset,
                end[0] - element.x + offset,
                end[1] - element.y + offset,
              );
              context.stroke();
            });
          }

          break;
      }

      context.restore();

      break;
  }

  // Middle indicator is not rendered after it expired
  if (!countdownInProgress || (state?.runtime ?? 0) > BIND_MODE_TIMEOUT) {
    return;
  }

  const radius = 0.5 * (Math.min(element.width, element.height) / 2);

  // Draw center snap area
  if (!isFrameLikeElement(element)) {
    context.save();
    context.translate(
      element.x + appState.scrollX,
      element.y + appState.scrollY,
    );

    const PROGRESS_RATIO = (1 / BIND_MODE_TIMEOUT) * remainingTime;

    context.strokeStyle = "rgba(0, 0, 0, 0.2)";
    context.lineWidth = 1 / appState.zoom.value;
    context.setLineDash([4 / appState.zoom.value, 4 / appState.zoom.value]);
    context.lineDashOffset = (-PROGRESS_RATIO * 10) / appState.zoom.value;

    context.beginPath();
    context.ellipse(
      element.width / 2,
      element.height / 2,
      radius,
      radius,
      0,
      0,
      2 * Math.PI,
    );
    context.stroke();

    // context.strokeStyle = "transparent";
    context.fillStyle = "rgba(0, 0, 0, 0.04)";
    context.beginPath();
    context.ellipse(
      element.width / 2,
      element.height / 2,
      radius * (1 - opacity),
      radius * (1 - opacity),
      0,
      0,
      2 * Math.PI,
    );

    context.fill();

    context.restore();

    if (appState.isMidpointSnappingEnabled) {
      // Draw midpoint indicators
      context.save();
      context.translate(
        element.x + appState.scrollX,
        element.y + appState.scrollY,
      );

      const midpointRadius = 5 / appState.zoom.value;
      const cutoutPadding = 5 / appState.zoom.value;
      const cutoutRadius = midpointRadius + cutoutPadding;

      let midpoints;
      if (element.type === "diamond") {
        const [, curves] = deconstructDiamondElement(element);
        const center = elementCenterPoint(element, allElementsMap);

        midpoints = curves.map((curve) => {
          const point = bezierEquation(curve, 0.5);
          const rotatedPoint = pointRotateRads(point, center, element.angle);
          return {
            x: rotatedPoint[0] - element.x,
            y: rotatedPoint[1] - element.y,
          };
        });
      } else {
        const center = elementCenterPoint(element, allElementsMap);
        const basePoints = [
          { x: element.width / 2, y: 0 }, // TOP
          { x: element.width, y: element.height / 2 }, // RIGHT
          { x: element.width / 2, y: element.height }, // BOTTOM
          { x: 0, y: element.height / 2 }, // LEFT
        ];
        midpoints = basePoints.map((point) => {
          const globalPoint = pointFrom<GlobalPoint>(
            point.x + element.x,
            point.y + element.y,
          );
          const rotatedPoint = pointRotateRads(
            globalPoint,
            center,
            element.angle,
          );
          return {
            x: rotatedPoint[0] - element.x,
            y: rotatedPoint[1] - element.y,
          };
        });
      }

      // Clear cutouts around midpoints
      midpoints.forEach((midpoint) => {
        context.clearRect(
          midpoint.x - cutoutRadius,
          midpoint.y - cutoutRadius,
          cutoutRadius * 2,
          cutoutRadius * 2,
        );
      });

      context.fillStyle =
        appState.theme === THEME.DARK
          ? `rgba(3, 93, 161, ${opacity})`
          : `rgba(106, 189, 252, ${opacity})`;

      midpoints.forEach((midpoint) => {
        context.beginPath();
        context.arc(midpoint.x, midpoint.y, midpointRadius, 0, 2 * Math.PI);
        context.fill();
      });

      context.restore();
    }
  }

  return {
    runtime: (state?.runtime ?? 0) + deltaTime,
  };
};

const renderBindingHighlightForBindableElement = (
  app: AppClassProperties,
  context: CanvasRenderingContext2D,
  suggestedBinding: AppState["suggestedBinding"],
  allElementsMap: NonDeletedSceneElementsMap,
  appState: InteractiveCanvasAppState,
  deltaTime: number,
  state?: { runtime: number },
) => {
  if (suggestedBinding === null) {
    return;
  }

  if (getFeatureFlag("COMPLEX_BINDINGS")) {
    return renderBindingHighlightForBindableElement_complex(
      app,
      context,
      suggestedBinding.element,
      allElementsMap,
      appState,
      deltaTime,
      state,
    );
  }

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  const pointerCoords = app.lastPointerMoveCoords
    ? pointFrom<GlobalPoint>(
        app.lastPointerMoveCoords.x,
        app.lastPointerMoveCoords.y,
      )
    : null;
  renderBindingHighlightForBindableElement_simple(
    context,
    suggestedBinding,
    allElementsMap,
    appState,
    pointerCoords,
  );
  context.restore();
};

type ElementSelectionBorder = {
  angle: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selectionColors: string[];
  dashed?: boolean;
  cx: number;
  cy: number;
  activeEmbeddable: boolean;
  padding?: number;
};

const renderSelectionBorder = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementProperties: ElementSelectionBorder,
) => {
  const {
    angle,
    x1,
    y1,
    x2,
    y2,
    selectionColors,
    cx,
    cy,
    dashed,
    activeEmbeddable,
  } = elementProperties;
  const elementWidth = x2 - x1;
  const elementHeight = y2 - y1;

  const padding =
    elementProperties.padding ?? DEFAULT_TRANSFORM_HANDLE_SPACING * 2;

  const linePadding = padding / appState.zoom.value;
  const lineWidth = 8 / appState.zoom.value;
  const spaceWidth = 4 / appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.lineWidth = (activeEmbeddable ? 4 : 1) / appState.zoom.value;

  const count = selectionColors.length;
  for (let index = 0; index < count; ++index) {
    context.strokeStyle = selectionColors[index];
    if (dashed) {
      context.setLineDash([
        lineWidth,
        spaceWidth + (lineWidth + spaceWidth) * (count - 1),
      ]);
    }
    context.lineDashOffset = (lineWidth + spaceWidth) * index;
    strokeRectWithRotation_simple(
      context,
      x1 - linePadding,
      y1 - linePadding,
      elementWidth + linePadding * 2,
      elementHeight + linePadding * 2,
      cx,
      cy,
      angle,
    );
  }
  context.restore();
};

const renderFrameHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  frame: NonDeleted<ExcalidrawFrameLikeElement>,
  elementsMap: ElementsMap,
) => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(frame, elementsMap);
  const width = x2 - x1;
  const height = y2 - y1;

  context.strokeStyle = "rgb(0,118,255)";
  context.lineWidth = FRAME_STYLE.strokeWidth / appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  strokeRectWithRotation_simple(
    context,
    x1,
    y1,
    width,
    height,
    x1 + width / 2,
    y1 + height / 2,
    frame.angle,
    false,
    FRAME_STYLE.radius / appState.zoom.value,
  );
  context.restore();
};

const renderElementsBoxHighlight = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elements: NonDeleted<ExcalidrawElement>[],
  config?: { colors?: string[]; dashed?: boolean },
) => {
  const { colors = ["rgb(0,118,255)"], dashed = false } = config || {};
  const individualElements = elements.filter(
    (element) => element.groupIds.length === 0,
  );

  const elementsInGroups = elements.filter(
    (element) => element.groupIds.length > 0,
  );

  const getSelectionFromElements = (elements: ExcalidrawElement[]) => {
    const [x1, y1, x2, y2] = getCommonBounds(elements);
    return {
      angle: 0,
      x1,
      x2,
      y1,
      y2,
      selectionColors: colors,
      dashed,
      cx: x1 + (x2 - x1) / 2,
      cy: y1 + (y2 - y1) / 2,
      activeEmbeddable: false,
    };
  };

  const getSelectionForGroupId = (groupId: GroupId) => {
    const groupElements = getElementsInGroup(elements, groupId);
    return getSelectionFromElements(groupElements);
  };

  Object.entries(selectGroupsFromGivenElements(elementsInGroups, appState))
    .filter(([id, isSelected]) => isSelected)
    .map(([id, isSelected]) => id)
    .map((groupId) => getSelectionForGroupId(groupId))
    .concat(
      individualElements.map((element) => getSelectionFromElements([element])),
    )
    .forEach((selection) =>
      renderSelectionBorder(context, appState, selection),
    );
};

const renderLinearPointHandles = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  element: NonDeleted<ExcalidrawLinearElement>,
  elementsMap: RenderableElementsMap,
) => {
  if (!appState.selectedLinearElement) {
    return;
  }
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.lineWidth = 1 / appState.zoom.value;
  const points: GlobalPoint[] = LinearElementEditor.getPointsGlobalCoordinates(
    element,
    elementsMap,
  );

  const { POINT_HANDLE_SIZE } = LinearElementEditor;
  const radius = appState.selectedLinearElement?.isEditing
    ? POINT_HANDLE_SIZE
    : POINT_HANDLE_SIZE / 2;

  const _isElbowArrow = isElbowArrow(element);
  const _isLineElement = isLineElement(element);

  points.forEach((point, idx) => {
    if (_isElbowArrow && idx !== 0 && idx !== points.length - 1) {
      return;
    }

    const isOverlappingPoint =
      idx > 0 &&
      (idx !== points.length - 1 || !_isLineElement || !element.polygon) &&
      pointsEqual(
        point,
        idx === points.length - 1 ? points[0] : points[idx - 1],
        2 / appState.zoom.value,
      );

    let isSelected =
      !!appState.selectedLinearElement?.isEditing &&
      !!appState.selectedLinearElement?.selectedPointsIndices?.includes(idx);
    // when element is a polygon, highlight the last point as well if first
    // point is selected since they overlap and the last point tends to be
    // rendered on top
    if (
      _isLineElement &&
      element.polygon &&
      !isSelected &&
      idx === element.points.length - 1 &&
      !!appState.selectedLinearElement?.isEditing &&
      !!appState.selectedLinearElement?.selectedPointsIndices?.includes(0)
    ) {
      isSelected = true;
    }

    renderSingleLinearPoint(
      context,
      appState,
      point,
      radius,
      isSelected,
      false,
      isOverlappingPoint,
    );
  });

  // Rendering segment mid points
  if (isElbowArrow(element)) {
    const fixedSegments =
      element.fixedSegments?.map((segment) => segment.index) || [];
    points.slice(0, -1).forEach((p, idx) => {
      if (
        !LinearElementEditor.isSegmentTooShort(
          element,
          points[idx + 1],
          points[idx],
          idx,
          appState.zoom,
          elementsMap,
        )
      ) {
        renderSingleLinearPoint(
          context,
          appState,
          pointFrom<GlobalPoint>(
            (p[0] + points[idx + 1][0]) / 2,
            (p[1] + points[idx + 1][1]) / 2,
          ),
          POINT_HANDLE_SIZE / 2,
          false,
          !fixedSegments.includes(idx + 1),
          false,
        );
      }
    });
  } else {
    const midPoints = LinearElementEditor.getEditorMidPoints(
      element,
      elementsMap,
      appState,
    ).filter(
      (midPoint, idx, midPoints): midPoint is GlobalPoint =>
        midPoint !== null &&
        !(isElbowArrow(element) && (idx === 0 || idx === midPoints.length - 1)),
    );

    midPoints.forEach((segmentMidPoint) => {
      if (appState.selectedLinearElement?.isEditing || points.length === 2) {
        renderSingleLinearPoint(
          context,
          appState,
          segmentMidPoint,
          POINT_HANDLE_SIZE / 2,
          false,
          true,
          false,
        );
      }
    });
  }

  context.restore();
};

const renderFocusPointConnectionLine = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  fromPoint: GlobalPoint,
  toPoint: GlobalPoint,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  context.strokeStyle = "rgba(134, 131, 226, 0.6)";
  context.lineWidth = 1 / appState.zoom.value;
  context.setLineDash([4 / appState.zoom.value, 4 / appState.zoom.value]);

  context.beginPath();
  context.moveTo(fromPoint[0], fromPoint[1]);
  context.lineTo(toPoint[0], toPoint[1]);
  context.stroke();

  context.restore();
};

const renderFocusPointCicle = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  point: GlobalPoint,
  radius: number,
  isHovered: boolean,
) => {
  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.strokeStyle = "rgba(134, 131, 226, 0.6)";
  context.lineWidth = 1 / appState.zoom.value;
  context.setLineDash([]);
  context.fillStyle = isHovered
    ? "rgba(134, 131, 226, 0.9)"
    : "rgba(255, 255, 255, 0.9)";

  fillCircle(
    context,
    point[0],
    point[1],
    radius / appState.zoom.value,
    true,
    true,
  );
  context.restore();
};

const renderFocusPointIndicator = ({
  arrow,
  appState,
  type,
  context,
  elementsMap,
}: {
  arrow: NonDeleted<ExcalidrawArrowElement>;
  appState: InteractiveCanvasAppState;
  context: CanvasRenderingContext2D;
  elementsMap: NonDeletedSceneElementsMap;
  type: "start" | "end";
}) => {
  const binding = type === "start" ? arrow.startBinding : arrow.endBinding;
  const bindableElement =
    binding?.elementId && elementsMap.get(binding.elementId);

  if (
    !bindableElement ||
    !isBindableElement(bindableElement) ||
    bindableElement.isDeleted
  ) {
    return;
  }

  const focusPoint = getGlobalFixedPointForBindableElement(
    binding.fixedPoint,
    bindableElement,
    elementsMap,
  );

  // Only render if focus point is within the bindable element
  if (
    !isFocusPointVisible(
      focusPoint,
      arrow,
      bindableElement,
      elementsMap,
      appState,
      type,
    )
  ) {
    return;
  }

  const linearState = appState.selectedLinearElement;
  const isDragging = !!linearState?.isDragging;
  const pointIndex = type === "start" ? 0 : arrow.points.length - 1;
  const pointSelected =
    !!linearState?.selectedPointsIndices?.includes(pointIndex);

  // render focus point highlight
  // ----------------------------

  if (
    linearState?.hoveredFocusPointBinding === type &&
    !linearState.draggedFocusPointBinding
  ) {
    renderFocusPointHighlight(context, appState, focusPoint);
  }

  // render focus point
  // ----------------------------

  if (!(pointSelected && isDragging)) {
    const focusPoint = getGlobalFixedPointForBindableElement(
      binding.fixedPoint,
      bindableElement,
      elementsMap,
    );

    const isHovered = linearState?.hoveredFocusPointBinding === type;

    // Render dashed line from arrow start point to focus point
    const arrowPoint = LinearElementEditor.getPointAtIndexGlobalCoordinates(
      arrow,
      pointIndex,
      elementsMap,
    );

    renderFocusPointConnectionLine(context, appState, arrowPoint, focusPoint);

    renderFocusPointCicle(
      context,
      appState,
      focusPoint,
      FOCUS_POINT_SIZE / 1.5,
      isHovered,
    );
  }
};

const renderTransformHandles = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  transformHandles: TransformHandles,
  angle: number,
): void => {
  Object.keys(transformHandles).forEach((key) => {
    const transformHandle = transformHandles[key as TransformHandleType];
    if (transformHandle !== undefined) {
      const [x, y, width, height] = transformHandle;

      context.save();
      context.lineWidth = 1 / appState.zoom.value;
      if (renderConfig.selectionColor) {
        context.strokeStyle = renderConfig.selectionColor;
      }
      if (key === "rotation") {
        fillCircle(context, x + width / 2, y + height / 2, width / 2, true);
        // prefer round corners if roundRect API is available
      } else if (context.roundRect) {
        context.beginPath();
        context.roundRect(x, y, width, height, 2 / appState.zoom.value);
        context.fill();
        context.stroke();
      } else {
        strokeRectWithRotation_simple(
          context,
          x,
          y,
          width,
          height,
          x + width / 2,
          y + height / 2,
          angle,
          true, // fill before stroke
        );
      }
      context.restore();
    }
  });
};

const renderCropHandles = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  croppingElement: ExcalidrawImageElement,
  elementsMap: ElementsMap,
): void => {
  const [x1, y1, , , cx, cy] = getElementAbsoluteCoords(
    croppingElement,
    elementsMap,
  );

  const LINE_WIDTH = 3;
  const LINE_LENGTH = 20;

  const ZOOMED_LINE_WIDTH = LINE_WIDTH / appState.zoom.value;
  const ZOOMED_HALF_LINE_WIDTH = ZOOMED_LINE_WIDTH / 2;

  const HALF_WIDTH = cx - x1 + ZOOMED_LINE_WIDTH;
  const HALF_HEIGHT = cy - y1 + ZOOMED_LINE_WIDTH;

  const HORIZONTAL_LINE_LENGTH = Math.min(
    LINE_LENGTH / appState.zoom.value,
    HALF_WIDTH,
  );
  const VERTICAL_LINE_LENGTH = Math.min(
    LINE_LENGTH / appState.zoom.value,
    HALF_HEIGHT,
  );

  context.save();
  context.fillStyle = renderConfig.selectionColor;
  context.strokeStyle = renderConfig.selectionColor;
  context.lineWidth = ZOOMED_LINE_WIDTH;

  const handles: Array<
    [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
  > = [
    [
      // x, y
      [-HALF_WIDTH, -HALF_HEIGHT],
      // horizontal line: first start and to
      [0, ZOOMED_HALF_LINE_WIDTH],
      [HORIZONTAL_LINE_LENGTH, ZOOMED_HALF_LINE_WIDTH],
      // vertical line: second  start and to
      [ZOOMED_HALF_LINE_WIDTH, 0],
      [ZOOMED_HALF_LINE_WIDTH, VERTICAL_LINE_LENGTH],
    ],
    [
      [HALF_WIDTH - ZOOMED_HALF_LINE_WIDTH, -HALF_HEIGHT],
      [ZOOMED_HALF_LINE_WIDTH, ZOOMED_HALF_LINE_WIDTH],
      [
        -HORIZONTAL_LINE_LENGTH + ZOOMED_HALF_LINE_WIDTH,
        ZOOMED_HALF_LINE_WIDTH,
      ],
      [0, 0],
      [0, VERTICAL_LINE_LENGTH],
    ],
    [
      [-HALF_WIDTH, HALF_HEIGHT],
      [0, -ZOOMED_HALF_LINE_WIDTH],
      [HORIZONTAL_LINE_LENGTH, -ZOOMED_HALF_LINE_WIDTH],
      [ZOOMED_HALF_LINE_WIDTH, 0],
      [ZOOMED_HALF_LINE_WIDTH, -VERTICAL_LINE_LENGTH],
    ],
    [
      [HALF_WIDTH - ZOOMED_HALF_LINE_WIDTH, HALF_HEIGHT],
      [ZOOMED_HALF_LINE_WIDTH, -ZOOMED_HALF_LINE_WIDTH],
      [
        -HORIZONTAL_LINE_LENGTH + ZOOMED_HALF_LINE_WIDTH,
        -ZOOMED_HALF_LINE_WIDTH,
      ],
      [0, 0],
      [0, -VERTICAL_LINE_LENGTH],
    ],
  ];

  handles.forEach((handle) => {
    const [[x, y], [x1s, y1s], [x1t, y1t], [x2s, y2s], [x2t, y2t]] = handle;

    context.save();
    context.translate(cx, cy);
    context.rotate(croppingElement.angle);

    context.beginPath();
    context.moveTo(x + x1s, y + y1s);
    context.lineTo(x + x1t, y + y1t);
    context.stroke();

    context.beginPath();
    context.moveTo(x + x2s, y + y2s);
    context.lineTo(x + x2t, y + y2t);
    context.stroke();
    context.restore();
  });

  context.restore();
};

const renderMaskEditor = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  maskingElement: ExcalidrawImageElement,
): void => {
  const { maskingPoints, maskingMode, selectedMaskPointIndex, zoom } = appState;
  if (!maskingPoints || maskingPoints.length === 0) {
    return;
  }

  try {
    context.save();

    const cx = maskingElement.x + maskingElement.width / 2;
    const cy = maskingElement.y + maskingElement.height / 2;
    const width = maskingElement.width;
    const height = maskingElement.height;

    const savedLocalPoints = maskingPoints.map((point) => {
      const localPoint = MaskEditor.globalToElementLocalDisplay(
        point,
        maskingElement,
      );

      return {
        x: localPoint.x - width / 2,
        y: localPoint.y - height / 2,
      };
    });

    // 绘制遮罩叠加层，用 clip 限制 destination-out 的范围
    context.save();
    context.translate(cx, cy);
    context.rotate(maskingElement.angle);
    context.scale(
      maskingElement.scale[0] < 0 ? -1 : 1,
      maskingElement.scale[1] < 0 ? -1 : 1,
    );

    // 创建裁剪区域，限制在图片范围内
    context.beginPath();
    context.rect(-width / 2, -height / 2, width, height);
    context.clip();

    if (maskingMode === "keepOutside") {
      context.fillStyle = "rgba(56, 132, 244, 0.15)";
      context.fillRect(-width / 2, -height / 2, width, height);
      context.globalCompositeOperation = "destination-out";
      MaskEditor.tracePolygonPath(context, savedLocalPoints);
      context.fillStyle = "black";
      context.fill();
      context.globalCompositeOperation = "source-over";
    } else {
      MaskEditor.tracePolygonPath(context, savedLocalPoints);
      context.fillStyle = "rgba(56, 132, 244, 0.15)";
      context.fill();
    }

    context.restore();

    // 绘制多边形轮廓
    context.strokeStyle = renderConfig.selectionColor;
    context.lineWidth = 2 / zoom.value;
    context.setLineDash([4 / zoom.value, 4 / zoom.value]);

    MaskEditor.tracePolygonPath(context, maskingPoints);
    context.stroke();
    context.setLineDash([]);

    // 绘制顶点手柄
    const handleSize = 10 / zoom.value;
    for (let i = 0; i < maskingPoints.length; i++) {
      const p = maskingPoints[i];
      const isSelected = i === selectedMaskPointIndex;

      context.beginPath();
      context.arc(p[0], p[1], handleSize / 2, 0, Math.PI * 2);
      context.fillStyle = isSelected ? renderConfig.selectionColor : "#fff";
      context.fill();
      context.strokeStyle = renderConfig.selectionColor;
      context.lineWidth = 2 / zoom.value;
      context.stroke();
    }

    // 绘制中点手柄（两个顶点之间的虚拟点）
    if (maskingPoints.length >= 2) {
      const midpointSize = MASK_MIDPOINT_HANDLE_SIZE / zoom.value;
      for (let i = 0; i < maskingPoints.length; i++) {
        const next = (i + 1) % maskingPoints.length;
        const midX = (maskingPoints[i][0] + maskingPoints[next][0]) / 2;
        const midY = (maskingPoints[i][1] + maskingPoints[next][1]) / 2;

        context.beginPath();
        context.arc(midX, midY, midpointSize / 2, 0, Math.PI * 2);
        context.fillStyle = "rgba(255, 255, 255, 0.8)";
        context.fill();
        context.strokeStyle = renderConfig.selectionColor;
        context.lineWidth = 1.5 / zoom.value;
        context.stroke();
      }
    }

    context.restore();
  } catch (err) {
    console.warn("Mask editor render error:", err);
  }
};

// ==================== 魔法抠图覆盖层 ====================

// 模块级临时 canvas 缓存，避免每帧创建新元素
let _magicWandTmpCanvas: HTMLCanvasElement | null = null;

const renderMagicWandOverlay = (
  context: CanvasRenderingContext2D,
  renderConfig: InteractiveCanvasRenderConfig,
  appState: InteractiveCanvasAppState,
  magicWandElement: ExcalidrawImageElement,
  app: AppClassProperties,
): void => {
  const { mask, contours } = app.getMagicWandOverlayData();
  if (!mask || !contours || contours.length === 0) {
    return;
  }

  const { zoom } = appState;
  const cx = magicWandElement.x + magicWandElement.width / 2;
  const cy = magicWandElement.y + magicWandElement.height / 2;
  const width = magicWandElement.width;
  const height = magicWandElement.height;

  try {
    context.save();

    // 绘制半透明蓝色覆盖层（选区部分）
    context.save();
    context.translate(cx, cy);
    context.rotate(magicWandElement.angle);
    context.scale(
      magicWandElement.scale[0] < 0 ? -1 : 1,
      magicWandElement.scale[1] < 0 ? -1 : 1,
    );

    // 裁剪到图片范围
    context.beginPath();
    context.rect(-width / 2, -height / 2, width, height);
    context.clip();

    // 使用临时 canvas 将掩码渲染为半透明蓝色覆盖
    if (
      !_magicWandTmpCanvas ||
      _magicWandTmpCanvas.width !== mask.width ||
      _magicWandTmpCanvas.height !== mask.height
    ) {
      _magicWandTmpCanvas = document.createElement("canvas");
      _magicWandTmpCanvas.width = mask.width;
      _magicWandTmpCanvas.height = mask.height;
    }
    const tmpCtx = _magicWandTmpCanvas.getContext("2d")!;
    const imgData = tmpCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i]) {
        const idx = i * 4;
        imgData.data[idx] = 56;     // R
        imgData.data[idx + 1] = 132; // G
        imgData.data[idx + 2] = 244; // B
        imgData.data[idx + 3] = 38;  // A
      }
    }
    tmpCtx.putImageData(imgData, 0, 0);
    context.drawImage(_magicWandTmpCanvas, -width / 2, -height / 2, width, height);
    context.restore();

    // 绘制 marching ants 轮廓虚线
    context.strokeStyle = renderConfig.selectionColor;
    context.lineWidth = 1.5 / zoom.value;
    context.setLineDash([4 / zoom.value, 4 / zoom.value]);

    for (const contour of contours) {
      if (contour.points.length < 2) {
        continue;
      }
      context.beginPath();
      const scaleX = width / mask.width;
      const scaleY = height / mask.height;
      const flipX = magicWandElement.scale[0] < 0 ? -1 : 1;
      const flipY = magicWandElement.scale[1] < 0 ? -1 : 1;
      // 轮廓点在图片像素坐标中，需要转换为全局坐标（含翻转）
      for (let i = 0; i < contour.points.length; i++) {
        const px = (contour.points[i].x * scaleX - width / 2) * flipX;
        const py = (contour.points[i].y * scaleY - height / 2) * flipY;
        // 应用元素变换
        const gx = cx + px * Math.cos(magicWandElement.angle) - py * Math.sin(magicWandElement.angle);
        const gy = cy + px * Math.sin(magicWandElement.angle) + py * Math.cos(magicWandElement.angle);
        if (i === 0) {
          context.moveTo(gx, gy);
        } else {
          context.lineTo(gx, gy);
        }
      }
      context.closePath();
      context.stroke();
    }

    context.setLineDash([]);
    context.restore();
  } catch (err) {
    console.warn("Magic wand overlay render error:", err);
  }
};

// ==================== 元素尺寸标签 ====================
const SIZE_LABEL_FONT_SIZE = 12;
const SIZE_LABEL_FONT_WEIGHT = "600";
const SIZE_LABEL_FONT_FAMILY = "Inter, system-ui, sans-serif";
const SIZE_LABEL_FONT = `${SIZE_LABEL_FONT_WEIGHT} ${SIZE_LABEL_FONT_SIZE}px ${SIZE_LABEL_FONT_FAMILY}`;
const SIZE_LABEL_PADDING_X = 10;
const SIZE_LABEL_PADDING_Y = 4;
const SIZE_LABEL_OFFSET_PX = 14;

let _sizeLabelMeasureCanvas: HTMLCanvasElement | null = null;
let _sizeLabelMeasureCtx: CanvasRenderingContext2D | null = null;

const measureSizeLabelText = (text: string): number => {
  if (typeof document === "undefined") {
    return text.length * 7;
  }
  if (!_sizeLabelMeasureCanvas) {
    _sizeLabelMeasureCanvas = document.createElement("canvas");
    _sizeLabelMeasureCtx = _sizeLabelMeasureCanvas.getContext("2d");
  }
  if (!_sizeLabelMeasureCtx) {
    return text.length * 7;
  }
  _sizeLabelMeasureCtx.font = SIZE_LABEL_FONT;
  return _sizeLabelMeasureCtx.measureText(text).width;
};

const formatDimensionValue = (value: number): string => {
  if (!isFinite(value)) {
    return "0";
  }
  const absolute = Math.abs(value);
  const rounded = Math.round(absolute * 100) / 100;
  if (rounded < 0.01) {
    return "0";
  }
  const fixed = rounded.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d*[1-9])0$/, "$1");
};

const renderElementSizeLabel = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectedElements: readonly NonDeleted<ExcalidrawElement>[],
  elementsMap: ElementsMap,
  selectionColor: string,
) => {
  if (selectedElements.length === 0) {
    return;
  }

  let width: number;
  let height: number;
  let cx: number;
  let cy: number;
  let angle: number;

  if (selectedElements.length === 1) {
    const element = selectedElements[0];
    const [, , , , absCx, absCy] = getElementAbsoluteCoords(
      element,
      elementsMap,
    );
    width = element.width;
    height = element.height;
    cx = absCx;
    cy = absCy;
    angle = element.angle;
  } else {
    const [x1, y1, x2, y2] = getCommonBounds(
      selectedElements,
      elementsMap,
    );
    width = x2 - x1;
    height = y2 - y1;
    cx = (x1 + x2) / 2;
    cy = (y1 + y2) / 2;
    angle = 0;
  }

  if (width < 0.01 && height < 0.01) {
    return;
  }

  const labelText = `${formatDimensionValue(Math.max(0, width))} \u00d7 ${formatDimensionValue(Math.max(0, height))}`;
  const textWidth = measureSizeLabelText(labelText);
  const pillWidth = textWidth + SIZE_LABEL_PADDING_X * 2;
  const pillHeight = SIZE_LABEL_FONT_SIZE + SIZE_LABEL_PADDING_Y * 2;
  const pillRadius = pillHeight / 2;
  const zoom = appState.zoom.value;

  // 计算标签位置：元素底部中心外侧，沿旋转方向偏移
  // 使用 pointRotateRads 旋转底部中心点，确保与元素旋转方向完全一致
  const offsetDistance = height / 2 + SIZE_LABEL_OFFSET_PX / zoom;
  const [labelX, labelY] = pointRotateRads(
    pointFrom(cx, cy + offsetDistance),
    pointFrom(cx, cy),
    angle as Radians,
  );

  // 规范化标签旋转角度，确保文字始终可读
  // 标签跟随元素旋转，当文字倾斜超过 90° 时翻转 180° 保持可读性
  let labelAngle = angle;
  // 将角度规范化到 [-π/2, π/2] 范围，超出则翻转
  while (labelAngle > Math.PI / 2) {
    labelAngle -= Math.PI;
  }
  while (labelAngle < -Math.PI / 2) {
    labelAngle += Math.PI;
  }

  context.save();
  context.translate(labelX, labelY);
  context.rotate(labelAngle);
  // 缩放以保持屏幕空间大小恒定
  context.scale(1 / zoom, 1 / zoom);

  // 绘制药丸形背景
  context.fillStyle = selectionColor || "#4262fa";
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      -pillWidth / 2,
      -pillHeight / 2,
      pillWidth,
      pillHeight,
      pillRadius,
    );
  } else {
    // roundRect 不可用时的回退方案：绘制矩形
    context.rect(
      -pillWidth / 2,
      -pillHeight / 2,
      pillWidth,
      pillHeight,
    );
  }
  context.fill();

  // 绘制尺寸文字
  context.fillStyle = "#ffffff";
  context.font = SIZE_LABEL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(labelText, 0, 0.5);

  context.restore();
};

const renderTextBox = (
  text: NonDeleted<ExcalidrawTextElement>,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
) => {
  context.save();
  const padding = getTextBoxPadding(appState.zoom.value);
  const width = text.width + padding * 2;
  const height = text.height + padding * 2;
  const cx = text.x + text.width / 2;
  const cy = text.y + text.height / 2;
  const shiftX = -(text.width / 2 + padding);
  const shiftY = -(text.height / 2 + padding);
  context.translate(cx + appState.scrollX, cy + appState.scrollY);
  context.rotate(text.angle);
  context.lineWidth = 1 / appState.zoom.value;
  context.strokeStyle = selectionColor;
  context.globalAlpha = 0.5;
  context.setLineDash([6 / appState.zoom.value, 4 / appState.zoom.value]);
  context.strokeRect(shiftX, shiftY, width, height);
  context.restore();
};

const renderResetAutoResizeHandle = (
  text: NonDeleted<ExcalidrawTextElement>,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
  formFactor: EditorInterface["formFactor"],
) => {
  const autoResizeHandle = getTextAutoResizeHandle(
    text,
    appState.zoom.value,
    formFactor,
  );

  if (!autoResizeHandle) {
    return;
  }

  context.save();
  context.globalAlpha = 0.5;
  context.lineWidth = 1.5 / appState.zoom.value;
  context.lineCap = "round";
  context.strokeStyle = selectionColor;
  context.beginPath();
  context.moveTo(
    autoResizeHandle.start[0] + appState.scrollX,
    autoResizeHandle.start[1] + appState.scrollY,
  );
  context.lineTo(
    autoResizeHandle.end[0] + appState.scrollX,
    autoResizeHandle.end[1] + appState.scrollY,
  );
  context.stroke();
  context.restore();
};

const _renderInteractiveScene = ({
  app,
  canvas,
  elementsMap,
  visibleElements,
  selectedElements,
  allElementsMap,
  scale,
  appState,
  renderConfig,
  editorInterface,
  animationState,
  deltaTime,
}: InteractiveSceneRenderConfig): {
  scrollBars?: ReturnType<typeof getScrollBars>;
  atLeastOneVisibleElement: boolean;
  elementsMap: RenderableElementsMap;
  animationState?: typeof animationState;
} => {
  if (canvas === null) {
    return { atLeastOneVisibleElement: false, elementsMap };
  }

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );
  let nextAnimationState = animationState;

  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
  });

  // Apply zoom
  context.save();
  context.scale(appState.zoom.value, appState.zoom.value);

  let editingLinearElement: NonDeleted<ExcalidrawLinearElement> | undefined =
    undefined;

  visibleElements.forEach((element) => {
    // Getting the element using LinearElementEditor during collab mismatches version - being one head of visible elements due to
    // ShapeCache returns empty hence making sure that we get the
    // correct element from visible elements
    if (
      appState.selectedLinearElement?.isEditing &&
      appState.selectedLinearElement.elementId === element.id
    ) {
      if (element) {
        editingLinearElement = element as NonDeleted<ExcalidrawLinearElement>;
      }
    }
  });

  if (editingLinearElement) {
    renderLinearPointHandles(
      context,
      appState,
      editingLinearElement,
      elementsMap,
    );
  }

  // Paint selection element
  if (appState.selectionElement && !appState.isCropping) {
    try {
      renderSelectionElement(
        appState.selectionElement,
        context,
        appState,
        renderConfig.selectionColor,
      );
    } catch (error: any) {
      console.error(error);
    }
  }

  const activeTextElement = getActiveTextElement(selectedElements, appState);

  if (activeTextElement && !activeTextElement.autoResize) {
    renderResetAutoResizeHandle(
      activeTextElement,
      context,
      appState,
      renderConfig.selectionColor,
      editorInterface.formFactor,
    );
  }

  if (appState.editingTextElement) {
    const textElement = allElementsMap.get(appState.editingTextElement.id) as
      | ExcalidrawTextElement
      | undefined;
    if (textElement && !textElement.autoResize) {
      renderTextBox(
        textElement,
        context,
        appState,
        renderConfig.selectionColor,
      );
    }
  }

  if (appState.isBindingEnabled && appState.suggestedBinding) {
    nextAnimationState = {
      ...animationState,
      bindingHighlight: renderBindingHighlightForBindableElement(
        app,
        context,
        appState.suggestedBinding,
        allElementsMap,
        appState,
        deltaTime,
        animationState?.bindingHighlight,
      ),
    };
  } else {
    nextAnimationState = {
      ...animationState,
      bindingHighlight: undefined,
    };
  }

  if (appState.frameToHighlight) {
    renderFrameHighlight(
      context,
      appState,
      appState.frameToHighlight,
      elementsMap,
    );
  }

  if (appState.elementsToHighlight) {
    renderElementsBoxHighlight(context, appState, appState.elementsToHighlight);
  }

  if (appState.activeLockedId) {
    const element = allElementsMap.get(appState.activeLockedId);
    const elements = element
      ? [element]
      : getElementsInGroup(allElementsMap, appState.activeLockedId);
    renderElementsBoxHighlight(context, appState, elements, {
      colors: ["#ced4da"],
      dashed: true,
    });
  }

  const isFrameSelected = selectedElements.some((element) =>
    isFrameLikeElement(element),
  );

  // Getting the element using LinearElementEditor during collab mismatches version - being one head of visible elements due to
  // ShapeCache returns empty hence making sure that we get the
  // correct element from visible elements
  if (
    selectedElements.length === 1 &&
    appState.selectedLinearElement?.isEditing &&
    appState.selectedLinearElement.elementId === selectedElements[0].id
  ) {
    renderLinearPointHandles(
      context,
      appState,
      selectedElements[0] as NonDeleted<ExcalidrawLinearElement>,
      elementsMap,
    );
  }

  const linearState = appState.selectedLinearElement;
  const selectedLinearElement =
    linearState &&
    LinearElementEditor.getElement(linearState.elementId, allElementsMap);
  // Arrows have a different highlight behavior when
  // they are the only selected element
  if (selectedLinearElement) {
    if (!appState.selectedLinearElement.isDragging) {
      if (linearState.segmentMidPointHoveredCoords) {
        renderElbowArrowMidPointHighlight(context, appState);
      } else if (
        isElbowArrow(selectedLinearElement)
          ? linearState.hoverPointIndex === 0 ||
            linearState.hoverPointIndex ===
              selectedLinearElement.points.length - 1
          : linearState.hoverPointIndex >= 0
      ) {
        renderLinearElementPointHighlight(context, appState, elementsMap);
      }
    }

    if (isArrowElement(selectedLinearElement)) {
      renderFocusPointIndicator({
        arrow: selectedLinearElement,
        elementsMap: allElementsMap,
        appState,
        context,
        type: "start",
      });

      renderFocusPointIndicator({
        arrow: selectedLinearElement,
        elementsMap: allElementsMap,
        appState,
        context,
        type: "end",
      });
    }
  }

  // Paint selected elements
  if (
    !appState.multiElement &&
    !appState.newElement &&
    !appState.selectedLinearElement?.isEditing
  ) {
    const showBoundingBox = hasBoundingBox(
      selectedElements,
      appState,
      editorInterface,
    );

    const isSingleLinearElementSelected =
      selectedElements.length === 1 && isLinearElement(selectedElements[0]);
    // render selected linear element points
    if (
      isSingleLinearElementSelected &&
      appState.selectedLinearElement?.elementId === selectedElements[0].id &&
      !selectedElements[0].locked
    ) {
      renderLinearPointHandles(
        context,
        appState,
        selectedElements[0] as ExcalidrawLinearElement,
        elementsMap,
      );
    }
    const selectionColor = renderConfig.selectionColor || "#000";

    if (showBoundingBox) {
      // Optimisation for finding quickly relevant element ids
      const locallySelectedIds = arrayToMap(selectedElements);

      const selections: ElementSelectionBorder[] = [];

      for (const element of elementsMap.values()) {
        const selectionColors = [];
        const remoteClients = renderConfig.remoteSelectedElementIds.get(
          element.id,
        );
        if (
          !(
            // Elbow arrow elements cannot be selected when bound on either end
            (
              isSingleLinearElementSelected &&
              isElbowArrow(element) &&
              (element.startBinding || element.endBinding)
            )
          )
        ) {
          // local user
          if (
            locallySelectedIds.has(element.id) &&
            !isSelectedViaGroup(appState, element)
          ) {
            selectionColors.push(selectionColor);
          }
          // remote users
          if (remoteClients) {
            selectionColors.push(
              ...remoteClients.map((socketId) => {
                const background = getClientColor(
                  socketId,
                  appState.collaborators.get(socketId),
                );
                return background;
              }),
            );
          }
        }

        if (selectionColors.length) {
          const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
            element,
            elementsMap,
            true,
          );
          selections.push({
            angle: element.angle,
            x1,
            y1,
            x2,
            y2,
            selectionColors: element.locked ? ["#ced4da"] : selectionColors,
            dashed: !!remoteClients || element.locked,
            cx,
            cy,
            activeEmbeddable:
              appState.activeEmbeddable?.element === element &&
              appState.activeEmbeddable.state === "active",
            padding:
              element.id === appState.croppingElementId ||
              isImageElement(element)
                ? 0
                : undefined,
          });
        }
      }

      const addSelectionForGroupId = (groupId: GroupId) => {
        const groupElements = getElementsInGroup(elementsMap, groupId);
        const [x1, y1, x2, y2] = getCommonBounds(groupElements);
        selections.push({
          angle: 0,
          x1,
          x2,
          y1,
          y2,
          selectionColors: groupElements.some((el) => el.locked)
            ? ["#ced4da"]
            : ["#000"],
          dashed: true,
          cx: x1 + (x2 - x1) / 2,
          cy: y1 + (y2 - y1) / 2,
          activeEmbeddable: false,
        });
      };

      for (const groupId of getSelectedGroupIds(appState)) {
        // TODO: support multiplayer selected group IDs
        addSelectionForGroupId(groupId);
      }

      if (appState.editingGroupId) {
        addSelectionForGroupId(appState.editingGroupId);
      }

      selections.forEach((selection) =>
        renderSelectionBorder(context, appState, selection),
      );
    }
    // Paint resize transformHandles
    context.save();
    context.translate(appState.scrollX, appState.scrollY);

    if (selectedElements.length === 1) {
      context.fillStyle = "#fff";
      const transformHandles = getTransformHandles(
        selectedElements[0],
        appState.zoom,
        elementsMap,
        "mouse", // when we render we don't know which pointer type so use mouse,
        getOmitSidesForEditorInterface(editorInterface),
      );
      if (
        !appState.viewModeEnabled &&
        showBoundingBox &&
        // do not show transform handles when text is being edited
        !isTextElement(appState.editingTextElement) &&
        // do not show transform handles when image is being cropped
        !appState.croppingElementId &&
        // do not show transform handles during mask editor
        !appState.maskingElementId &&
        // do not show transform handles during magic wand
        !appState.magicWandElementId
      ) {
        renderTransformHandles(
          context,
          renderConfig,
          appState,
          transformHandles,
          selectedElements[0].angle,
        );
      }

      if (appState.croppingElementId && !appState.isCropping) {
        const croppingElement = elementsMap.get(appState.croppingElementId);

        if (croppingElement && isImageElement(croppingElement)) {
          renderCropHandles(
            context,
            renderConfig,
            appState,
            croppingElement,
            elementsMap,
          );
        }
      }

      // 渲染元素尺寸标签
      if (
        showBoundingBox &&
        !isTextElement(appState.editingTextElement) &&
        !appState.maskingElementId &&
        !appState.magicWandElementId
      ) {
        renderElementSizeLabel(
          context,
          appState,
          selectedElements,
          elementsMap,
          selectionColor,
        );
      }
    } else if (
      selectedElements.length > 1 &&
      !appState.isRotating &&
      !selectedElements.some((el) => el.locked)
    ) {
      const dashedLinePadding =
        (DEFAULT_TRANSFORM_HANDLE_SPACING * 2) / appState.zoom.value;
      context.fillStyle = "#fff";
      const [x1, y1, x2, y2] = getCommonBounds(selectedElements, elementsMap);
      const initialLineDash = context.getLineDash();
      context.setLineDash([2 / appState.zoom.value]);
      const lineWidth = context.lineWidth;
      context.lineWidth = 1 / appState.zoom.value;
      context.strokeStyle = selectionColor;
      strokeRectWithRotation_simple(
        context,
        x1 - dashedLinePadding,
        y1 - dashedLinePadding,
        x2 - x1 + dashedLinePadding * 2,
        y2 - y1 + dashedLinePadding * 2,
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        0,
      );
      context.lineWidth = lineWidth;
      context.setLineDash(initialLineDash);
      const transformHandles = getTransformHandlesFromCoords(
        [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
        0 as Radians,
        appState.zoom,
        "mouse",
        isFrameSelected
          ? {
              ...getOmitSidesForEditorInterface(editorInterface),
              rotation: true,
            }
          : getOmitSidesForEditorInterface(editorInterface),
      );
      if (selectedElements.some((element) => !element.locked)) {
        renderTransformHandles(
          context,
          renderConfig,
          appState,
          transformHandles,
          0,
        );
      }

      // 渲染元素尺寸标签
      renderElementSizeLabel(
        context,
        appState,
        selectedElements,
        elementsMap,
        selectionColor,
      );
    }

    if (appState.maskingElementId) {
      const maskingElement = elementsMap.get(appState.maskingElementId);

      if (maskingElement && isImageElement(maskingElement)) {
        renderMaskEditor(context, renderConfig, appState, maskingElement);
      }
    }

    if (appState.magicWandElementId) {
      const magicWandElement = elementsMap.get(appState.magicWandElementId);

      if (magicWandElement && isImageElement(magicWandElement)) {
        renderMagicWandOverlay(context, renderConfig, appState, magicWandElement, app);
      }
    }

    context.restore();
  }

  appState.searchMatches?.matches.forEach(({ id, focus, matchedLines }) => {
    const element = elementsMap.get(id);

    if (element) {
      const [elementX1, elementY1, , , cx, cy] = getElementAbsoluteCoords(
        element,
        elementsMap,
        true,
      );

      context.save();
      if (appState.theme === THEME.LIGHT) {
        if (focus) {
          context.fillStyle = "rgba(255, 124, 0, 0.4)";
        } else {
          context.fillStyle = "rgba(255, 226, 0, 0.4)";
        }
      } else if (focus) {
        context.fillStyle = "rgba(229, 82, 0, 0.4)";
      } else {
        context.fillStyle = "rgba(99, 52, 0, 0.4)";
      }

      const zoomFactor = isFrameLikeElement(element) ? appState.zoom.value : 1;

      context.translate(appState.scrollX, appState.scrollY);
      context.translate(cx, cy);
      context.rotate(element.angle);

      matchedLines.forEach((matchedLine) => {
        (matchedLine.showOnCanvas || focus) &&
          context.fillRect(
            elementX1 + matchedLine.offsetX / zoomFactor - cx,
            elementY1 + matchedLine.offsetY / zoomFactor - cy,
            matchedLine.width / zoomFactor,
            matchedLine.height / zoomFactor,
          );
      });

      context.restore();
    }
  });

  renderSnaps(context, appState);

  context.restore();

  renderRemoteCursors({
    context,
    renderConfig,
    appState,
    normalizedWidth,
    normalizedHeight,
  });

  // Paint scrollbars
  let scrollBars;
  if (renderConfig.renderScrollbars) {
    scrollBars = getScrollBars(
      elementsMap,
      normalizedWidth,
      normalizedHeight,
      appState,
    );

    context.save();
    context.fillStyle = SCROLLBAR_COLOR;
    context.strokeStyle = "rgba(255,255,255,0.8)";
    [scrollBars.horizontal, scrollBars.vertical].forEach((scrollBar) => {
      if (scrollBar) {
        roundRect(
          context,
          scrollBar.x,
          scrollBar.y,
          scrollBar.width,
          scrollBar.height,
          SCROLLBAR_WIDTH / 2,
        );
      }
    });
    context.restore();
  }

  return {
    scrollBars,
    atLeastOneVisibleElement: visibleElements.length > 0,
    elementsMap,
    animationState: nextAnimationState,
  };
};

/**
 * Interactive scene is the ui-canvas where we render bounding boxes, selections
 * and other ui stuff.
 */
export const renderInteractiveScene = <
  U extends typeof _renderInteractiveScene,
>(
  renderConfig: InteractiveSceneRenderConfig,
): ReturnType<U> => {
  const ret = _renderInteractiveScene(renderConfig);
  renderConfig.callback(ret);
  return ret as ReturnType<U>;
};
