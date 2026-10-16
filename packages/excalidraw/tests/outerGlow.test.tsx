import React from "react";

import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { act, render, screen, togglePopover } from "./test-utils";

const mouse = new Pointer("mouse");

describe("outer glow", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(async () => {
    // https://github.com/floating-ui/floating-ui/issues/1908#issuecomment-1301553793
    // affects node v16+
    await act(async () => {});
  });

  const createSelectedRect = () => {
    UI.clickTool("rectangle");
    mouse.down(10, 10);
    mouse.up(60, 60);
    return API.getSnapshot()[0];
  };

  it("opens the custom color panel popover for outer glow", async () => {
    createSelectedRect();

    // reveal the glow controls and enable glow
    togglePopover("Outer glow");
    const colorTrigger = await screen.findByLabelText("Outer glow color");

    // clicking the trigger must open the custom color panel popover
    colorTrigger.click();
    await act(async () => {});

    expect(document.querySelector(".color-picker-content")).not.toBeNull();
  });

  it("does not clobber glow state when opening the color panel", async () => {
    createSelectedRect();

    togglePopover("Outer glow");
    const colorTrigger = await screen.findByLabelText("Outer glow color");

    const before = API.getSnapshot()[0].outerGlow;
    expect(before?.enabled).toBe(true);

    colorTrigger.click();
    await act(async () => {});

    const after = API.getSnapshot()[0].outerGlow;
    expect(after?.enabled).toBe(true);
    expect(after?.color).toBe(before?.color);
    expect(after?.width).toBe(before?.width);
  });
});
