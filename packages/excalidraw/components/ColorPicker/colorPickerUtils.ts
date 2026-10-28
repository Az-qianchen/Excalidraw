import {
  isTransparent,
  MAX_CUSTOM_COLORS_USED_IN_CANVAS,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ColorPickerColor, ColorPaletteCustom } from "@excalidraw/common";

import { atom } from "../../editor-jotai";

export const getColorNameAndShadeFromColor = ({
  palette,
  color,
}: {
  palette: ColorPaletteCustom;
  color: string | null;
}): {
  colorName: ColorPickerColor;
  shade: number | null;
} | null => {
  if (!color) {
    return null;
  }
  for (const [colorName, colorVal] of Object.entries(palette)) {
    if (Array.isArray(colorVal)) {
      const shade = colorVal.indexOf(color);
      if (shade > -1) {
        return { colorName: colorName as ColorPickerColor, shade };
      }
    } else if (colorVal === color) {
      return { colorName: colorName as ColorPickerColor, shade: null };
    }
  }
  return null;
};

export const colorPickerHotkeyBindings = [
  ["q", "w", "e", "r", "t"],
  ["a", "s", "d", "f", "g"],
  ["z", "x", "c", "v", "b"],
].flat();

export const isCustomColor = ({
  color,
  palette,
}: {
  color: string;
  palette: ColorPaletteCustom;
}) => {
  const paletteValues = Object.values(palette).flat();
  return !paletteValues.includes(color);
};

export const getMostUsedCustomColors = (
  elements: readonly ExcalidrawElement[],
  type: "elementBackground" | "elementStroke" | "elementOuterGlow",
  palette: ColorPaletteCustom,
) => {
  const elementColorTypeMap: Record<string, string> = {
    elementBackground: "backgroundColor",
    elementStroke: "strokeColor",
    elementOuterGlow: "outerGlow",
  };

  // outerGlow 是对象，取其 color 字段作为颜色
  const getColor = (element: ExcalidrawElement): string | null => {
    if (type === "elementOuterGlow") {
      return element.outerGlow?.color ?? null;
    }
    const colorKey = elementColorTypeMap[type] as "backgroundColor" | "strokeColor";
    return (element as any)[colorKey] as string;
  };

  const colors = elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }
    const color = getColor(element);
    // fully-transparent colors are "no color", not a reusable custom color
    // (matters for palettes that exclude `transparent`, e.g. bucket fill)
    return color !== null && !isTransparent(color) && isCustomColor({ color, palette });
  });

  const colorCountMap = new Map<string, number>();
  colors.forEach((element) => {
    const color = getColor(element);
    if (color === null) {
      return;
    }
    if (colorCountMap.has(color)) {
      colorCountMap.set(color, colorCountMap.get(color)! + 1);
    } else {
      colorCountMap.set(color, 1);
    }
  });

  return [...colorCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((c) => c[0])
    .slice(0, MAX_CUSTOM_COLORS_USED_IN_CANVAS);
};

export type ActiveColorPickerSectionAtomType =
  | "custom"
  | "baseColors"
  | "shades"
  | "hsla" // HSLA 颜色调整滑块区域
  | "hex"
  | null;
export const activeColorPickerSectionAtom =
  atom<ActiveColorPickerSectionAtomType>(null);

export type ColorPickerType =
  | "canvasBackground"
  | "elementBackground"
  | "elementStroke"
  | "elementOuterGlow";
