import { useState } from "react";

import { getNormalizedGridSize, getNormalizedGridStep } from "../scene";
import { isGridModeEnabled } from "../snapping";
import { t } from "../i18n";
import { checkIcon, emptyIcon, gridIcon } from "./icons";
import { ToolButton } from "./ToolButton";
import { Popover } from "radix-ui";
import { PropertiesPopover } from "./PropertiesPopover";
import { useExcalidrawContainer } from "./App";
import { StrokeWidthInput } from "./StrokeWidthInput";

import type { AppClassProperties, UIAppState } from "../types";

import "./GridSettings.scss";

export const GridSettings = ({
  app,
  appState,
  setAppState,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  setAppState: React.Component<any, UIAppState>["setState"];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { container } = useExcalidrawContainer();
  const gridEnabled = isGridModeEnabled(app);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <ToolButton
          type="button"
          icon={gridIcon}
          title={t("labels.toggleGrid")}
          aria-label={t("labels.toggleGrid")}
          onClick={() => setIsOpen((v) => !v)}
          data-testid="toolbar-grid"
        />
      </Popover.Trigger>
      {isOpen && (
        <PropertiesPopover
          className="grid-settings-popover"
          container={container}
          style={{ maxWidth: "14rem" }}
          onClose={() => setIsOpen(false)}
        >
          <div className="selected-shape-actions">
            <button
              type="button"
              className="grid-settings__toggle"
              onClick={() => {
                setAppState({
                  gridModeEnabled: !gridEnabled,
                  objectsSnapModeEnabled: false,
                });
              }}
            >
              <span className="grid-settings__check-icon">
                {gridEnabled ? checkIcon : emptyIcon}
              </span>
              {t("labels.toggleGrid")}
            </button>

            <fieldset disabled={!gridEnabled}>
              <div className="grid-settings__field">
                <label className="grid-settings__label">
                  {t("labels.gridSize")}
                </label>
                <StrokeWidthInput
                  value={appState.gridSize}
                  min={1}
                  max={500}
                  onChange={(val) => {
                    setAppState({ gridSize: getNormalizedGridSize(val) });
                  }}
                />
              </div>

              <div className="grid-settings__field">
                <label className="grid-settings__label">
                  {t("labels.gridStep")}
                </label>
                <StrokeWidthInput
                  value={appState.gridStep}
                  min={1}
                  max={100}
                  onChange={(val) => {
                    setAppState({ gridStep: getNormalizedGridStep(val) });
                  }}
                />
              </div>
            </fieldset>
          </div>
        </PropertiesPopover>
      )}
    </Popover.Root>
  );
};
