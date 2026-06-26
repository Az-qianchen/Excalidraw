import React, { useCallback, useEffect, useRef, useState } from "react";

import { t } from "../../i18n";

const SIDEBAR_WIDTH_STORAGE_KEY = "excalidraw_sidebar_width";
export const DEFAULT_SIDEBAR_WIDTH = 302;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 600;

export const getStoredSidebarWidth = (): number => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SIDEBAR_WIDTH;
    }
    const value = parseInt(raw, 10);
    if (!Number.isFinite(value)) {
      return DEFAULT_SIDEBAR_WIDTH;
    }
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
};

const storeSidebarWidth = (width: number) => {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // ignore quota / serialization errors
  }
};

/**
 * Applies the sidebar width to the nearest `.excalidraw-container` ancestor
 * by setting the `--right-sidebar-width` CSS variable directly on the DOM.
 * This avoids the need for cross-component reactivity since the sidebar,
 * the layer-ui wrapper, and the canvas all read this CSS variable.
 */
const applySidebarWidth = (handleEl: HTMLElement, width: number) => {
  const container = handleEl.closest(".excalidraw-container");
  if (container) {
    (container as HTMLElement).style.setProperty(
      "--right-sidebar-width",
      `${width}px`,
    );
  }
};

type SidebarResizeHandleProps = {
  onResize?: (width: number) => void;
};

export const SidebarResizeHandle: React.FC<SidebarResizeHandleProps> = ({
  onResize,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const draggingWidthRef = useRef<number>(DEFAULT_SIDEBAR_WIDTH);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(true);

      const handleEl = event.currentTarget;
      const startX = event.clientX;
      // read current width from the DOM CSS variable
      const container = handleEl.closest(".excalidraw-container");
      const currentWidthStr = container
        ? getComputedStyle(container).getPropertyValue("--right-sidebar-width")
        : "";
      const currentWidth = parseInt(currentWidthStr, 10);
      draggingWidthRef.current = Number.isFinite(currentWidth)
        ? currentWidth
        : DEFAULT_SIDEBAR_WIDTH;
      const startWidth = draggingWidthRef.current;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        // sidebar is on the right edge, dragging left increases width
        const delta = startX - moveEvent.clientX;
        const nextWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + delta),
        );
        draggingWidthRef.current = nextWidth;
        applySidebarWidth(handleEl, nextWidth);
        onResizeRef.current?.(nextWidth);
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        storeSidebarWidth(draggingWidthRef.current);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [],
  );

  // prevent body text selection while dragging
  useEffect(() => {
    if (isDragging) {
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      return () => {
        document.body.style.userSelect = prevUserSelect;
      };
    }
  }, [isDragging]);

  return (
    <div
      className={`sidebar-resize-handle${isDragging ? " is-dragging" : ""}`}
      onPointerDown={handlePointerDown}
      title={t("labels.sidebarResize")}
      role="separator"
      aria-orientation="vertical"
    />
  );
};

export { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STORAGE_KEY };
