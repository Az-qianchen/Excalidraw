import type { TextSpan } from "@excalidraw/element/types";

// 文本编辑器句柄类型，用于注册编辑器实例并提供选区和颜色操作接口
type TextEditorHandle = {
  getSelection: () => { start: number; end: number } | null;
  applyColorToSelection: (color: string) => void;
};

// 当前活跃的文本编辑器实例映射
const activeEditors = new Map<string, TextEditorHandle>();

// 注册文本编辑器实例，使其可通过元素 ID 访问
export const registerTextEditor = (
  elementId: string,
  handle: TextEditorHandle,
) => {
  activeEditors.set(elementId, handle);
};

// 注销文本编辑器实例
export const unregisterTextEditor = (elementId: string) => {
  activeEditors.delete(elementId);
};

// 对当前选中的文本应用颜色，返回是否成功
export const applyColorToTextSelection = (
  elementId: string,
  color: string,
): boolean => {
  const editor = activeEditors.get(elementId);
  if (!editor) {
    return false;
  }
  editor.applyColorToSelection(color);
  return true;
};

// 获取当前文本选区位置
export const getTextSelection = (
  elementId: string,
): { start: number; end: number } | null => {
  const editor = activeEditors.get(elementId);
  if (!editor) {
    return null;
  }
  return editor.getSelection();
};

/**
 * 对指定范围内的 span 应用颜色。
 * 会根据选区边界拆分现有 span，并合并相邻同色 span。
 */
export const applyColorToSpans = (
  text: string,
  spans: readonly TextSpan[] | undefined,
  start: number,
  end: number,
  color: string,
): TextSpan[] => {
  const baseSpans = spans && spans.length > 0 ? [...spans] : [{ text }];

  const result: TextSpan[] = [];
  let offset = 0;

  for (const span of baseSpans) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;

    if (spanEnd <= start || spanStart >= end) {
      result.push({ ...span });
    } else if (spanStart >= start && spanEnd <= end) {
      result.push({ ...span, color });
    } else if (spanStart < start && spanEnd > end) {
      result.push({
        text: span.text.slice(0, start - spanStart),
        color: span.color,
      });
      result.push({
        text: span.text.slice(start - spanStart, end - spanStart),
        color,
      });
      result.push({
        text: span.text.slice(end - spanStart),
        color: span.color,
      });
    } else if (spanStart < start) {
      result.push({
        text: span.text.slice(0, start - spanStart),
        color: span.color,
      });
      result.push({ text: span.text.slice(start - spanStart), color });
    } else {
      result.push({ text: span.text.slice(0, end - spanStart), color });
      result.push({
        text: span.text.slice(end - spanStart),
        color: span.color,
      });
    }

    offset = spanEnd;
  }

  return mergeAdjacentSpans(result);
};

/**
 * 文本内容变化时更新 span 数组。
 *
 * 通过比较新旧文本的差异，保留未受影响部分的格式，
 * 新插入的文本继承光标位置处的颜色。
 *
 * 优先用光标位置定位编辑区域（对含重复字符的纯删除/插入场景
 * 能正确归属颜色）；若光标定位无法验证，回退到最长公共前后缀。
 */
export const updateSpansOnTextChange = (
  oldText: string,
  newText: string,
  spans: readonly TextSpan[] | undefined,
  cursorPosition: number,
): TextSpan[] | undefined => {
  if (!spans || spans.length === 0) {
    return undefined;
  }

  if (oldText === newText) {
    return [...spans];
  }

  const oldLen = oldText.length;
  const newLen = newText.length;

  const computePrefixSuffix = (): [number, number] => {
    let prefixLen = 0;
    const minLen = Math.min(oldLen, newLen);
    while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
      prefixLen++;
    }
    let suffixLen = 0;
    while (
      suffixLen < minLen - prefixLen &&
      oldText[oldLen - 1 - suffixLen] === newText[newLen - 1 - suffixLen]
    ) {
      suffixLen++;
    }
    return [prefixLen, suffixLen];
  };

  let prefixLen: number;
  let suffixLen: number;

  if (oldLen > newLen) {
    // 净删除：删除区域在 oldText [delStart, delStart + deletedLen)
    const deletedLen = oldLen - newLen;
    const delStart = Math.max(0, Math.min(cursorPosition, oldLen - deletedLen));
    if (
      oldText.slice(0, delStart) + oldText.slice(delStart + deletedLen) ===
      newText
    ) {
      prefixLen = delStart;
      suffixLen = oldLen - delStart - deletedLen;
    } else {
      [prefixLen, suffixLen] = computePrefixSuffix();
    }
  } else if (newLen > oldLen) {
    // 净插入：插入区域在 newText [insStart, insStart + insertedLen)
    const insertedLen = newLen - oldLen;
    const insStart = Math.max(
      0,
      Math.min(cursorPosition, newLen) - insertedLen,
    );
    if (
      newText.slice(0, insStart) + newText.slice(insStart + insertedLen) ===
      oldText
    ) {
      prefixLen = insStart;
      suffixLen = oldLen - insStart;
    } else {
      [prefixLen, suffixLen] = computePrefixSuffix();
    }
  } else {
    [prefixLen, suffixLen] = computePrefixSuffix();
  }

  const getColorAt = (pos: number): string | undefined => {
    let offset = 0;
    for (const span of spans!) {
      if (pos >= offset && pos < offset + span.text.length) {
        return span.color;
      }
      offset += span.text.length;
    }
    if (spans!.length > 0) {
      return spans![spans!.length - 1].color;
    }
    return undefined;
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

  const insertedLen = newLen - prefixLen - suffixLen;
  if (insertedLen > 0) {
    const insertedText = newText.slice(prefixLen, prefixLen + insertedLen);
    const color = getColorAt(Math.max(0, prefixLen - 1));
    result.push({ text: insertedText, color });
  }

  if (suffixLen > 0) {
    const suffixStart = oldLen - suffixLen;
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

  const merged = mergeAdjacentSpans(result.filter((s) => s.text.length > 0));

  const totalText = merged.map((s) => s.text).join("");
  if (totalText !== newText) {
    return [{ text: newText }];
  }

  return merged;
};

// 合并相邻且颜色相同的 span，减少冗余
const mergeAdjacentSpans = (spans: TextSpan[]): TextSpan[] => {
  if (spans.length <= 1) {
    return spans;
  }
  const merged: TextSpan[] = [{ ...spans[0] }];
  for (let i = 1; i < spans.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = spans[i];
    if (prev.color === curr.color) {
      merged[merged.length - 1] = {
        text: prev.text + curr.text,
        color: prev.color,
      };
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
};
