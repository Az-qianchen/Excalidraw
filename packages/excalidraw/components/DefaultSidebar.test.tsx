import React from "react";

import { DEFAULT_SIDEBAR } from "@excalidraw/common";

import { DefaultSidebar } from "../index";

import {
  assertExcalidrawWithSidebar,
  assertSidebarDockButton,
} from "./Sidebar/siderbar.test.helpers";

describe("DefaultSidebar", () => {
  it("should be always docked with no dock button", async () => {
    await assertExcalidrawWithSidebar(
      <DefaultSidebar />,
      DEFAULT_SIDEBAR.name,
      async () => {
        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).toHaveClass("sidebar--docked");
      },
    );
  });

  it("should ignore docked prop and stay docked", async () => {
    await assertExcalidrawWithSidebar(
      <DefaultSidebar docked={false} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).toHaveClass("sidebar--docked");
      },
    );
  });

  it("should ignore onDock prop and stay docked", async () => {
    await assertExcalidrawWithSidebar(
      <DefaultSidebar onDock={() => {}} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).toHaveClass("sidebar--docked");
      },
    );
  });
});
