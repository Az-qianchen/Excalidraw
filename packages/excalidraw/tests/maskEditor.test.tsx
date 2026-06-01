import React from "react";
import { vi } from "vitest";

import { KEYS } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawImageElement, FileId } from "@excalidraw/element/types";

import { actionToggleMaskEditor } from "../actions/actionMaskEditor";
import { Excalidraw } from "../index";
import { MaskEditor } from "../mask-editor";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import { act, render, waitFor } from "./test-utils";

const { h } = window;

const renderEditor = async () => {
  await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
};

const createSelectedImage = () => {
  const image = API.createElement({
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    fileId: "old-file" as FileId,
  });

  API.updateScene({
    elements: [image],
    appState: { selectedElementIds: { [image.id]: true } },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  h.history.clear();

  return image;
};

const startMaskEditor = () => {
  API.executeAction(actionToggleMaskEditor);
  expect(h.state.maskingElementId).toBe(h.elements[0].id);
};

describe("mask editor interactions", () => {
  const pointer = new Pointer("mouse");

  beforeEach(async () => {
    await renderEditor();
    pointer.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps point editing undo local and does not create global undo entries when canceling", () => {
    createSelectedImage();
    startMaskEditor();

    expect(h.history.undoStack).toHaveLength(0);

    pointer.clickAt(20, 20);
    pointer.clickAt(100, 20);
    pointer.clickAt(100, 100);
    expect(h.state.maskingPoints).toEqual([
      [20, 20],
      [100, 20],
      [100, 100],
    ]);

    pointer.downAt(20, 20);
    pointer.moveTo(30, 30);
    pointer.upAt(30, 30);
    expect(h.state.maskingPoints[0]).toEqual([30, 30]);

    Keyboard.keyPress(KEYS.DELETE);
    expect(h.state.maskingPoints).toEqual([
      [100, 20],
      [100, 100],
    ]);

    Keyboard.undo();
    expect(h.state.maskingPoints).toEqual([
      [30, 30],
      [100, 20],
      [100, 100],
    ]);

    Keyboard.undo();
    expect(h.state.maskingPoints).toEqual([
      [20, 20],
      [100, 20],
      [100, 100],
    ]);

    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.maskingElementId).toBeNull();
    expect(h.state.maskingPoints).toEqual([]);
    expect(h.history.undoStack).toHaveLength(0);

    Keyboard.undo();
    expect(h.elements).toHaveLength(1);
    expect(h.elements[0].isDeleted).toBe(false);
  });

  it("keeps Backspace/Delete scoped to an active mask editor", () => {
    createSelectedImage();

    Keyboard.keyPress(KEYS.DELETE);
    expect(h.elements[0].isDeleted).toBe(true);

    Keyboard.undo();
    expect(h.elements[0].isDeleted).toBe(false);

    startMaskEditor();
    pointer.clickAt(20, 20);
    pointer.clickAt(100, 20);

    Keyboard.keyPress(KEYS.BACKSPACE);
    expect(h.elements[0].isDeleted).toBe(false);
    expect(h.state.maskingPoints).toEqual([[20, 20]]);
  });

  it("captures applied masks as one global undo entry without restoring editor-only state", async () => {
    const image = createSelectedImage();
    const oldFileId = image.fileId;
    startMaskEditor();
    pointer.clickAt(20, 20);
    pointer.clickAt(100, 20);
    pointer.clickAt(100, 100);

    vi.spyOn(MaskEditor, "applyMask").mockResolvedValue({
      dataURL:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luz7vwAAAABJRU5ErkJggg==",
      newWidth: 1,
      newHeight: 1,
    });

    Keyboard.keyPress(KEYS.ENTER);

    await waitFor(() => {
      expect(h.state.maskingElementId).toBeNull();
      expect((h.elements[0] as ExcalidrawImageElement).fileId).not.toBe(
        oldFileId,
      );
    });

    expect(h.history.undoStack).toHaveLength(1);

    act(() => {
      Keyboard.undo();
    });

    await waitFor(() => {
      expect((h.elements[0] as ExcalidrawImageElement).fileId).toBe(oldFileId);
      expect(h.state.maskingElementId).toBeNull();
      expect(h.state.maskingPoints).toEqual([]);
    });
  });
});
