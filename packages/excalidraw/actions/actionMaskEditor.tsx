import { isImageElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { ToolButton } from "../components/ToolButton";
import { maskIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

export const actionToggleMaskEditor = register({
  name: "maskEditor",
  label: "helpDialog.maskStart",
  icon: maskIcon,
  viewMode: true,
  trackEvent: { category: "menu" },
  keywords: ["image", "mask", "background", "remove"],
  perform(elements, appState, _, app) {
    const selectedElement = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    })[0] as ExcalidrawImageElement;

    return {
      appState: {
        ...appState,
        maskingElementId: selectedElement.id,
        maskingPoints: [],
        maskingMode: "keepInside",
        selectedMaskPointIndex: null,
        isMasking: false,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  predicate: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    if (
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
    const label = t("helpDialog.maskStart");

    return (
      <ToolButton
        type="button"
        icon={maskIcon}
        title={label}
        aria-label={label}
        onClick={() => updateData(null)}
      />
    );
  },
});
