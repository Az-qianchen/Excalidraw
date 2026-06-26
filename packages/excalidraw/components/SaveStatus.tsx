import React, { useMemo } from "react";
import clsx from "clsx";

import { hashElementsVersion } from "@excalidraw/element";

import { useUIAppState } from "../context/ui-appState";

import { actionSaveToActiveFile, actionSaveFileToDisk } from "../actions";
import { useI18n } from "../i18n";

import {
  useExcalidrawElements,
  useExcalidrawActionManager,
  useApp,
} from "./App";

import "./SaveStatus.scss";

type SaveStatusType = "saved" | "unsaved";

const STATUS_COLORS: Record<SaveStatusType, string> = {
  saved: "#2ecc71",
  unsaved: "#e74c3c",
};

export const SaveStatus: React.FC = () => {
  const { t } = useI18n();
  const appState = useUIAppState();
  const elements = useExcalidrawElements();
  const actionManager = useExcalidrawActionManager();
  const app = useApp();

  const currentHash = useMemo(
    () => hashElementsVersion(elements.filter((el) => !el.isDeleted)),
    [elements],
  );

  const status: SaveStatusType | null = useMemo(() => {
    if (!appState.fileHandle && !appState.name) {
      return null;
    }
    if (
      appState.lastSavedElementsHash !== null &&
      appState.lastSavedElementsHash === currentHash
    ) {
      return "saved";
    }
    return "unsaved";
  }, [
    appState.fileHandle,
    appState.name,
    appState.lastSavedElementsHash,
    currentHash,
  ]);

  const displayName = app.getName();

  if (!status) {
    return null;
  }

  const color = STATUS_COLORS[status];

  const handleClick = () => {
    if (status === "saved") {
      return;
    }
    if (actionManager.isActionEnabled(actionSaveToActiveFile)) {
      actionManager.executeAction(actionSaveToActiveFile);
    } else {
      actionManager.executeAction(actionSaveFileToDisk);
    }
  };

  const title =
    status === "saved" ? t("saveStatus.saved") : t("saveStatus.unsavedChanges");

  return (
    <div
      className={clsx("SaveStatus", `SaveStatus--${status}`)}
      onClick={handleClick}
      title={title}
      role="status"
      aria-live="polite"
    >
      <span
        className={clsx("SaveStatus__indicator", {
          "SaveStatus__indicator--pulse": status === "unsaved",
        })}
        style={{
          backgroundColor: color,
          boxShadow: `0 0 4px ${color}80`,
        }}
      />
      <span className="SaveStatus__label" style={{ color }}>
        {status === "saved"
          ? t("saveStatus.saved")
          : t("saveStatus.unsavedChanges")}
      </span>
      <span className="SaveStatus__name">{displayName}</span>
    </div>
  );
};
