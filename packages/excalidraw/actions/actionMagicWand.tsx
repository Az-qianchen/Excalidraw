import { isImageElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { ToolButton } from "../components/ToolButton";
import { MagicIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

export const actionToggleMagicWand = register({
  name: "magicWand",
  label: "helpDialog.magicWandStart",
  icon: MagicIcon,
  viewMode: true,
  trackEvent: { category: "menu" },
  keywords: ["image", "magic", "wand", "cutout", "remove", "background"],
  perform(elements, appState, _, app) {
    const selectedElement = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    })[0] as ExcalidrawImageElement;

    return {
      appState: {
        ...appState,
        magicWandElementId: selectedElement.id,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  predicate: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    if (
      !appState.magicWandElementId &&
      !appState.maskingElementId &&
      !appState.croppingElementId &&
      selectedElements.length === 1 &&
      isImageElement(selectedElements[0])
    ) {
      return true;
    }
    return false;
  },
  PanelComponent: ({ appState, updateData, app }) => {
    const label = t("helpDialog.magicWandStart");

    return (
      <ToolButton
        type="button"
        icon={MagicIcon}
        title={label}
        aria-label={label}
        onClick={() => updateData(null)}
      />
    );
  },
});
