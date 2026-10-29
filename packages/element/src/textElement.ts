import {
  ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO,
  ARROW_LABEL_WIDTH_FRACTION,
  BOUND_TEXT_PADDING,
  DEFAULT_FONT_SIZE,
  STICKY_NOTE_BODY_INSET_Y,
  STICKY_NOTE_PADDING,
  TEXT_ALIGN,
  VERTICAL_ALIGN,
  getFontString,
  isProdEnv,
  invariant,
} from "@excalidraw/common";

import { pointFrom, pointRotateRads, type Radians } from "@excalidraw/math";

import type { ExtractSetType } from "@excalidraw/common/utility-types";

import { resetOriginalContainerCache } from "./containerCache";
import { LinearElementEditor } from "./linearElementEditor";
import { getPositionAfterHeightChange } from "./sizeHelpers";

import { updateStickyNoteLayout } from "./stickyNote";
import { measureText } from "./textMeasurements";
import { getWrappedTextLines, wrapText } from "./textWrapping";
import {
  isBoundToContainer,
  isArrowElement,
  isStickyNoteElement,
  isTextElement,
} from "./typeChecks";

import { isNonDeletedElement } from ".";

import type { RenderEnvironment } from "./renderEnvironment";

import type { Scene } from "./Scene";

import type { MaybeTransformHandleType } from "./transformHandles";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawElementType,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
  FontString,
  NonDeleted,
  NonDeletedExcalidrawElement,
  TextSpan,
} from "./types";

/**
 * 将 TextSpan 数组按可视行拆分。
 *
 * 当提供 `originalText`/`font`/`maxWidth` 时，使用 `getWrappedTextLines`
 * 计算软换行，使 span 渲染与 textarea 的 `pre-wrap` 行为一致；
 * `maxWidth` 为 `Infinity` 时退化为仅按硬换行符拆分（用于不换行的文本）。
 *
 * span 的文本拼接应等于 `originalText`；若不一致（span 已过期，例如
 * IME 组合输入期间 originalText 已含拼音字符而 spans 尚未同步），不能
 * 退化为仅按硬换行拆分——那样会丢失软换行让整段挤成一行、且拼音字符
 * 不会被绘制。改为以 `originalText` 作为软换行布局来源，并把 spans 临时
 * 对齐到 `originalText`（多出的拼音字符继承相邻 span 颜色），让组合输入
 * 预览期间仍沿用既有换行形式且拼音可见。
 */
export const splitSpansIntoLines = (
  spans: readonly TextSpan[],
  originalText?: string,
  font?: FontString,
  maxWidth: number = Infinity,
): TextSpan[][] => {
  if (
    originalText === undefined ||
    font === undefined ||
    !Number.isFinite(maxWidth)
  ) {
    return splitSpansByHardLineBreaks(spans);
  }

  const spansTotal = spans.reduce((n, s) => n + s.text.length, 0);
  const effectiveSpans =
    spansTotal === originalText.length
      ? spans
      : reconcileSpansForRendering(spans, originalText);

  const wrappedLines = getWrappedTextLines(originalText, font, maxWidth);
  const spanRanges: {
    start: number;
    end: number;
    text: string;
    color?: string;
  }[] = [];
  let offset = 0;
  for (const span of effectiveSpans) {
    spanRanges.push({
      start: offset,
      end: offset + span.text.length,
      text: span.text,
      color: span.color,
    });
    offset += span.text.length;
  }

  const result: TextSpan[][] = wrappedLines.map(() => []);
  for (let li = 0; li < wrappedLines.length; li++) {
    const lineStart = wrappedLines[li].start;
    const lineEnd = wrappedLines[li].end;
    for (const span of spanRanges) {
      if (span.end <= lineStart) {
        continue;
      }
      if (span.start >= lineEnd) {
        break;
      }
      const cutStart = Math.max(span.start, lineStart);
      const cutEnd = Math.min(span.end, lineEnd);
      const text = span.text.slice(cutStart - span.start, cutEnd - span.start);
      if (text) {
        result[li].push({ text, color: span.color });
      }
    }
  }
  return result;
};

const splitSpansByHardLineBreaks = (
  spans: readonly TextSpan[],
): TextSpan[][] => {
  const lines: TextSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
      }
      if (parts[i]) {
        lines[lines.length - 1].push({ text: parts[i], color: span.color });
      }
    }
  }
  return lines;
};

/**
 * 生成一组与 `originalText` 对齐的临时 spans，仅供渲染使用。
 *
 * 在 `spans` 拼接文本与 `originalText` 长度/内容不一致时（典型场景：
 * IME 组合输入期间 `originalText` 已含拼音字符而 spans 尚未在
 * `compositionend` 同步），用最长公共前缀/后缀定位差异段：
 * - 前缀、后缀沿用原 spans 的颜色
 * - 差异段（多出的拼音/被替换的字符）继承前一个 span 的颜色，
 *   没有前一个 span 则置空（渲染层会用元素默认色绘制）
 *
 * 这只是渲染端的临时对齐，不会回写到元素；`compositionend` 时
 * `updateSpansOnTextChange` 仍会做正式的 spans 同步。
 */
const reconcileSpansForRendering = (
  spans: readonly TextSpan[],
  originalText: string,
): readonly TextSpan[] => {
  if (spans.length === 0) {
    return [{ text: originalText, color: "" }];
  }

  const spansText = spans.map((s) => s.text).join("");
  if (spansText === originalText) {
    return spans;
  }

  const minLen = Math.min(spansText.length, originalText.length);
  let prefixLen = 0;
  while (
    prefixLen < minLen &&
    spansText[prefixLen] === originalText[prefixLen]
  ) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    spansText[spansText.length - 1 - suffixLen] ===
      originalText[originalText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const getColorAt = (pos: number): string | undefined => {
    let offset = 0;
    for (const span of spans) {
      if (pos >= offset && pos < offset + span.text.length) {
        return span.color;
      }
      offset += span.text.length;
    }
    return spans[spans.length - 1].color;
  };

  const result: TextSpan[] = [];

  if (prefixLen > 0) {
    let offset = 0;
    for (const span of spans) {
      const spanEnd = offset + span.text.length;
      if (offset >= prefixLen) {
        break;
      }
      if (spanEnd <= prefixLen) {
        result.push({ ...span });
      } else {
        result.push({
          text: span.text.slice(0, prefixLen - offset),
          color: span.color,
        });
      }
      offset = spanEnd;
    }
  }

  const diffEnd = originalText.length - suffixLen;
  if (diffEnd > prefixLen) {
    const insertedText = originalText.slice(prefixLen, diffEnd);
    const color = prefixLen > 0 ? getColorAt(prefixLen - 1) : "";
    result.push({ text: insertedText, color });
  }

  if (suffixLen > 0) {
    const suffixStart = spansText.length - suffixLen;
    let offset = 0;
    for (const span of spans) {
      const spanEnd = offset + span.text.length;
      if (spanEnd <= suffixStart) {
        offset = spanEnd;
        continue;
      }
      if (offset >= suffixStart) {
        result.push({ ...span });
      } else {
        result.push({
          text: span.text.slice(suffixStart - offset),
          color: span.color,
        });
      }
      offset = spanEnd;
    }
  }

  const joined = result.map((s) => s.text).join("");
  if (joined !== originalText) {
    return [{ text: originalText, color: "" }];
  }
  return result;
};

export const redrawTextBoundingBox = (
  textElement: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
  scene: Scene,
  renderEnvironment?: RenderEnvironment,
) => {
  const elementsMap = scene.getNonDeletedElementsMap();

  if (container && isStickyNoteElement(container)) {
    // the sticky fit owns both halves (label + note geometry). `textElement`
    // may be an uncommitted clone (font actions clone before install), so it
    // is passed explicitly instead of looked up in the scene
    updateStickyNoteLayout(container, scene, {
      text: textElement,
      renderEnvironment,
    });
    return;
  }

  let maxWidth = undefined;

  if (!isProdEnv()) {
    invariant(
      !container || !isArrowElement(container) || textElement.angle === 0,
      "text element angle must be 0 if bound to arrow container",
    );
  }

  const boundTextUpdates = {
    x: textElement.x,
    y: textElement.y,
    text: textElement.text,
    width: textElement.width,
    height: textElement.height,
    angle: (container
      ? isArrowElement(container)
        ? 0
        : container.angle
      : textElement.angle) as Radians,
  };

  boundTextUpdates.text = textElement.text;

  if (container || !textElement.autoResize) {
    maxWidth = container
      ? getBoundTextMaxWidth(container, textElement)
      : textElement.width;
    boundTextUpdates.text = wrapText(
      textElement.originalText,
      getFontString(textElement),
      maxWidth,
      renderEnvironment,
    );
  }

  const metrics = measureText(
    boundTextUpdates.text,
    getFontString(textElement),
    textElement.lineHeight,
    renderEnvironment,
  );

  // Note: only update width for unwrapped text and bound texts (which always have autoResize set to true)
  if (textElement.autoResize) {
    boundTextUpdates.width = metrics.width;
  }
  boundTextUpdates.height = metrics.height;

  if (container) {
    const updatedTextElement = {
      ...textElement,
      ...boundTextUpdates,
    } as ExcalidrawTextElementWithContainer;

    const { x, y } = computeBoundTextPosition(
      container,
      updatedTextElement,
      elementsMap,
    );

    boundTextUpdates.x = x;
    boundTextUpdates.y = y;
  }

  scene.mutateElement(textElement, boundTextUpdates);
};

export const handleBindTextResize = (
  container: ExcalidrawElement,
  scene: Scene,
  transformHandleType: MaybeTransformHandleType,
  shouldMaintainAspectRatio = false,
  shouldResizeFromCenter = false,
  flipByY = false,
  renderEnvironment?: RenderEnvironment,
) => {
  if (isStickyNoteElement(container)) {
    // resize callers pass their intents to `updateStickyNoteLayout` directly
    // and own the bound-arrow pass; this is the fallback for generic callers
    updateStickyNoteLayout(container, scene, {
      bindings: false,
      renderEnvironment,
    });
    return;
  }
  const elementsMap = scene.getNonDeletedElementsMap();
  const boundTextElementId = getBoundTextElementId(container);
  if (!boundTextElementId) {
    return;
  }
  resetOriginalContainerCache(container.id);
  const textElement = getBoundTextElement(container, elementsMap);
  if (textElement && textElement.text) {
    if (!container) {
      return;
    }

    let text = textElement.text;
    let nextHeight = textElement.height;
    let nextWidth = textElement.width;
    const maxWidth = getBoundTextMaxWidth(container, textElement);
    const maxHeight = getBoundTextMaxHeight(container, textElement);
    let containerHeight = container.height;
    if (
      shouldMaintainAspectRatio ||
      (transformHandleType !== "n" && transformHandleType !== "s")
    ) {
      if (text) {
        text = wrapText(
          textElement.originalText,
          getFontString(textElement),
          maxWidth,
          renderEnvironment,
        );
      }
      const metrics = measureText(
        text,
        getFontString(textElement),
        textElement.lineHeight,
        renderEnvironment,
      );
      nextHeight = metrics.height;
      nextWidth = metrics.width;
    }
    // increase height in case text element height exceeds (but not an
    // arrow's, which its points determine, and its label doesn't grow)
    if (!isArrowElement(container) && nextHeight > maxHeight) {
      containerHeight = computeContainerDimensionForBoundText(
        nextHeight,
        container.type,
      );

      // Crossing the opposite edge swaps the anchor for text-driven growth.
      const shouldResizeFromTop =
        (transformHandleType === "n" ||
          transformHandleType === "ne" ||
          transformHandleType === "nw") !== flipByY;

      scene.mutateElement(container, {
        height: containerHeight,
        ...getPositionAfterHeightChange(
          container,
          containerHeight,
          shouldResizeFromCenter
            ? "center"
            : shouldResizeFromTop
            ? "bottom"
            : "top",
        ),
      });
    }

    scene.mutateElement(textElement, {
      text,
      width: nextWidth,
      height: nextHeight,
    });

    if (!isArrowElement(container)) {
      scene.mutateElement(
        textElement,
        computeBoundTextPosition(container, textElement, elementsMap),
      );
    }
  }
};

export const computeBoundTextPosition = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
  elementsMap: ElementsMap,
) => {
  if (isArrowElement(container)) {
    return LinearElementEditor.getBoundTextElementPosition(
      container,
      boundTextElement,
      elementsMap,
    );
  }
  const containerCoords = getContainerCoords(container);
  const maxContainerHeight = getBoundTextMaxHeight(container, boundTextElement);
  const maxContainerWidth = getBoundTextMaxWidth(container, boundTextElement);

  let x;
  let y;
  if (boundTextElement.verticalAlign === VERTICAL_ALIGN.TOP) {
    y = containerCoords.y;
  } else if (boundTextElement.verticalAlign === VERTICAL_ALIGN.BOTTOM) {
    y = containerCoords.y + (maxContainerHeight - boundTextElement.height);
  } else if (isStickyNoteElement(container)) {
    // a note's label body ends above the creation-date footer, but a label
    // centered in that body sits visibly high — center it in the whole
    // padded note while it stays clear of the footer, and only push it up
    // against the body's bottom once it would overlap
    const paddedHeight = container.height - STICKY_NOTE_PADDING * 2;
    y =
      containerCoords.y +
      Math.min(
        (paddedHeight - boundTextElement.height) / 2,
        maxContainerHeight - boundTextElement.height,
      );
  } else {
    y =
      containerCoords.y +
      (maxContainerHeight / 2 - boundTextElement.height / 2);
  }
  if (boundTextElement.textAlign === TEXT_ALIGN.LEFT) {
    x = containerCoords.x;
  } else if (boundTextElement.textAlign === TEXT_ALIGN.RIGHT) {
    x = containerCoords.x + (maxContainerWidth - boundTextElement.width);
  } else {
    x =
      containerCoords.x + (maxContainerWidth / 2 - boundTextElement.width / 2);
  }
  const angle = (container.angle ?? 0) as Radians;

  if (angle !== 0) {
    // A sticky's footer makes its body asymmetric. The body still rotates
    // about the note's center, rather than about its own (higher) center.
    const contentCenter = isStickyNoteElement(container)
      ? pointFrom(
          container.x + container.width / 2,
          container.y + container.height / 2,
        )
      : pointFrom(
          containerCoords.x + maxContainerWidth / 2,
          containerCoords.y + maxContainerHeight / 2,
        );
    const textCenter = pointFrom(
      x + boundTextElement.width / 2,
      y + boundTextElement.height / 2,
    );

    const [rx, ry] = pointRotateRads(textCenter, contentCenter, angle);

    return {
      x: rx - boundTextElement.width / 2,
      y: ry - boundTextElement.height / 2,
    };
  }

  return { x, y };
};

export const getBoundTextElementId = (container: ExcalidrawElement | null) => {
  return container?.boundElements?.length
    ? container?.boundElements?.find((ele) => ele.type === "text")?.id || null
    : null;
};

export const getBoundTextElement = (
  element: ExcalidrawElement | null,
  elementsMap: ElementsMap,
): NonDeleted<ExcalidrawTextElementWithContainer> | null => {
  if (!element) {
    return null;
  }
  const boundTextElementId = getBoundTextElementId(element);

  if (boundTextElementId) {
    const boundTextElement = (elementsMap.get(boundTextElementId) ||
      null) as NonDeleted<ExcalidrawTextElementWithContainer> | null;

    // SAFETY: This should never happen, but log it just in case
    if (boundTextElement && !isNonDeletedElement(boundTextElement)) {
      console.error(
        "[NONDELETED][INVARIANT] Bound text element `isDeleted: true` which is not expected.",
      );
    }

    return boundTextElement;
  }
  return null;
};

export const getContainerElement = <
  T extends ExcalidrawTextElement,
  R extends ExcalidrawTextContainer,
>(
  element: T | null,
  elementsMap: ElementsMap,
): R | null => {
  if (!element) {
    return null;
  }
  if (element.containerId) {
    return (elementsMap.get(element.containerId) || null) as R | null;
  }
  return null;
};

/**
 * The point a text bound to this container centers on — and, for arrows, the
 * point the text tool snaps a new label to.
 */
export const getContainerCenter = (
  container: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  if (!isArrowElement(container)) {
    return {
      x: container.x + container.width / 2,
      y: container.y + container.height / 2,
    };
  }

  const center = LinearElementEditor.getBoundTextElementCenter(
    container,
    elementsMap,
  );

  return { x: center[0], y: center[1] };
};

export const getContainerCoords = (container: ExcalidrawElement) => {
  const padding = isStickyNoteElement(container)
    ? STICKY_NOTE_PADDING
    : BOUND_TEXT_PADDING;
  let offsetX = padding;
  let offsetY = padding;

  if (container.type === "ellipse") {
    // The derivation of coordinates is explained in https://github.com/excalidraw/excalidraw/pull/6172
    offsetX += (container.width / 2) * (1 - Math.sqrt(2) / 2);
    offsetY += (container.height / 2) * (1 - Math.sqrt(2) / 2);
  }
  // The derivation of coordinates is explained in https://github.com/excalidraw/excalidraw/pull/6265
  if (container.type === "diamond") {
    offsetX += container.width / 4;
    offsetY += container.height / 4;
  }
  return {
    x: container.x + offsetX,
    y: container.y + offsetY,
  };
};

export const getTextElementAngle = (
  textElement: ExcalidrawTextElement,
  container: ExcalidrawTextContainer | null,
) => {
  if (isArrowElement(container)) {
    return 0;
  }
  if (!container) {
    return textElement.angle;
  }
  return container.angle;
};

export const getBoundTextElementPosition = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
  elementsMap: ElementsMap,
) => {
  if (isArrowElement(container)) {
    return LinearElementEditor.getBoundTextElementPosition(
      container,
      boundTextElement,
      elementsMap,
    );
  }
};

/**
 * Returns the text element with its accurate coords. An arrow label's
 * position is derived from the arrow at render time rather than kept in
 * sync on the element itself (see getBoundTextElementPosition), so
 * consumers reading a label's coords directly must go through this helper.
 */
export const getTextElementWithAccuratePosition = <
  T extends ExcalidrawTextElement,
>(
  textElement: T,
  elementsMap: ElementsMap,
): T => {
  if (!textElement.containerId) {
    return textElement;
  }
  const container = elementsMap.get(textElement.containerId);
  if (!container || !isArrowElement(container)) {
    return textElement;
  }
  return {
    ...textElement,
    ...LinearElementEditor.getBoundTextElementPosition(
      container,
      textElement as ExcalidrawTextElementWithContainer,
      elementsMap,
    ),
  };
};

export const shouldAllowVerticalAlign = (
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  return selectedElements.some((element) => {
    if (isBoundToContainer(element)) {
      const container = getContainerElement(element, elementsMap);
      if (isArrowElement(container)) {
        return false;
      }
      return true;
    }
    return false;
  });
};

export const suppportsHorizontalAlign = (
  selectedElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  return selectedElements.some((element) => {
    if (isBoundToContainer(element)) {
      const container = getContainerElement(element, elementsMap);
      if (isArrowElement(container)) {
        return false;
      }
      return true;
    }

    return isTextElement(element);
  });
};

const VALID_CONTAINER_TYPES = new Set([
  "rectangle",
  "stickynote",
  "ellipse",
  "diamond",
  "arrow",
]);

export const isValidTextContainer = (element: {
  type: ExcalidrawElementType;
}): element is ExcalidrawTextContainer =>
  VALID_CONTAINER_TYPES.has(element.type);

export const computeContainerDimensionForBoundText = (
  dimension: number,
  containerType: ExtractSetType<typeof VALID_CONTAINER_TYPES>,
) => {
  dimension = Math.ceil(dimension);
  const padding = BOUND_TEXT_PADDING * 2;

  if (containerType === "ellipse") {
    return Math.round(((dimension + padding) / Math.sqrt(2)) * 2);
  }
  if (containerType === "arrow") {
    return dimension + padding * 8;
  }
  if (containerType === "diamond") {
    return 2 * (dimension + padding);
  }
  return dimension + padding;
};

export const getBoundTextMaxWidth = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElement | null,
) => {
  const { width } = container;
  if (isArrowElement(container)) {
    const minWidth =
      (boundTextElement?.fontSize ?? DEFAULT_FONT_SIZE) *
      ARROW_LABEL_FONT_SIZE_TO_MIN_WIDTH_RATIO;
    return Math.max(ARROW_LABEL_WIDTH_FRACTION * width, minWidth);
  }
  if (container.type === "ellipse") {
    // The width of the largest rectangle inscribed inside an ellipse is
    // Math.round((ellipse.width / 2) * Math.sqrt(2)) which is derived from
    // equation of an ellipse -https://github.com/excalidraw/excalidraw/pull/6172
    return Math.round((width / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2;
  }
  if (container.type === "diamond") {
    // The width of the largest rectangle inscribed inside a rhombus is
    // Math.round(width / 2) - https://github.com/excalidraw/excalidraw/pull/6265
    return Math.round(width / 2) - BOUND_TEXT_PADDING * 2;
  }
  return (
    width -
    (isStickyNoteElement(container)
      ? STICKY_NOTE_PADDING
      : BOUND_TEXT_PADDING) *
      2
  );
};

export const getBoundTextMaxHeight = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer,
) => {
  const { height } = container;
  if (isStickyNoteElement(container)) {
    // the label body ends above the creation-date footer
    return Math.max(0, height - STICKY_NOTE_BODY_INSET_Y);
  }
  if (isArrowElement(container)) {
    const containerHeight = height - BOUND_TEXT_PADDING * 8 * 2;
    if (containerHeight <= 0) {
      return boundTextElement.height;
    }
    return height;
  }
  if (container.type === "ellipse") {
    // The height of the largest rectangle inscribed inside an ellipse is
    // Math.round((ellipse.height / 2) * Math.sqrt(2)) which is derived from
    // equation of an ellipse - https://github.com/excalidraw/excalidraw/pull/6172
    return Math.round((height / 2) * Math.sqrt(2)) - BOUND_TEXT_PADDING * 2;
  }
  if (container.type === "diamond") {
    // The height of the largest rectangle inscribed inside a rhombus is
    // Math.round(height / 2) - https://github.com/excalidraw/excalidraw/pull/6265
    return Math.round(height / 2) - BOUND_TEXT_PADDING * 2;
  }
  return height - BOUND_TEXT_PADDING * 2;
};

/** retrieves text from text elements and concatenates to a single string */
export const getTextFromElements = (
  elements: readonly ExcalidrawElement[],
  separator = "\n\n",
) => {
  const text = elements
    .reduce((acc: string[], element) => {
      if (isTextElement(element)) {
        acc.push(element.text);
      }
      return acc;
    }, [])
    .join(separator);
  return text;
};

export const DEFAULT_BOUND_TEXT_LABEL_POSITION = 0.5;
