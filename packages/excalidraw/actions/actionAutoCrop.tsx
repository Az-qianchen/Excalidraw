import {
  isImageElement,
  isInitializedImageElement,
  autoCropImageElement,
  detectContentBounds,
  CaptureUpdateAction,
} from "@excalidraw/element";

import type { InitializedExcalidrawImageElement } from "@excalidraw/element/types";

import { ToolButton } from "../components/ToolButton";
import { cropAutoIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

export const actionAutoCrop = register({
  name: "autoCrop",
  label: "helpDialog.autoCrop",
  icon: cropAutoIcon,
  viewMode: true,
  trackEvent: { category: "menu", action: "autoCrop" },
  keywords: ["image", "crop", "trim", "whitespace", "transparent"],
  predicate: (elements, appState, _, app) => {
    if (appState.croppingElementId || appState.maskingElementId || appState.magicWandElementId) {
      return false;
    }
    const selectedElements = app.scene.getSelectedElements(appState);
    if (selectedElements.length !== 1) {
      return false;
    }
    const el = selectedElements[0];
    return (
      isImageElement(el) &&
      isInitializedImageElement(el) &&
      !el.locked
    );
  },
  perform(elements, appState, _, app) {
    const el = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    })[0] as InitializedExcalidrawImageElement;

    const image = app.imageCache.get(el.fileId)?.image;
    const bounds =
      image && !(image instanceof Promise)
        ? detectContentBounds(image, el.crop)
        : null;
    if (!bounds) {
      return {
        appState,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      };
    }

    app.scene.mutateElement(el, autoCropImageElement(el, bounds));

    return {
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ updateData }) => {
    const label = t("helpDialog.autoCrop");
    return (
      <ToolButton
        type="button"
        icon={cropAutoIcon}
        title={label}
        aria-label={label}
        onClick={() => updateData(null)}
      />
    );
  },
});
