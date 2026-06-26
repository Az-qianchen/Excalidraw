import React, { useCallback, useEffect, useMemo, useState } from "react";

import { CaptureUpdateAction, hashElementsVersion } from "@excalidraw/element";

import { MIME_TYPES } from "@excalidraw/common";

import { actionClearCanvas } from "../actions";

import {
  chooseDirectory,
  createFileInDirectory,
  ensureDirectoryPermission,
  listDirectoryEntries,
  loadDirectoryHandleFromIDB,
  saveDirectoryHandleToIDB,
  saveFileHandleToIDB,
  type DirectoryAccessError,
  type DirectoryFileEntry,
} from "../data/filesystem";
import { loadFromBlob } from "../data";
import { serializeAsJSON } from "../data/json";

import { t } from "../i18n";

import {
  useApp,
  useExcalidrawActionManager,
  useExcalidrawAppState,
  useExcalidrawElements,
} from "./App";
import { fileIcon, filePlusIcon, folderOpenIcon, refreshIcon } from "./icons";

import "./LayersMenu.scss";

import type { Action } from "../actions/types";

const formatTimestamp = (ts: number | undefined): string => {
  if (!ts) {
    return t("filesPanel.unknownDate");
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
};

const errorMessageFor = (error: DirectoryAccessError | null): string | null => {
  if (!error) {
    return null;
  }
  switch (error.type) {
    case "unsupported":
      return t("filesPanel.unsupported");
    case "permission":
      return t("filesPanel.permissionDenied");
    case "unknown":
      return error.message
        ? t("filesPanel.unknownErrorWithMessage", { message: error.message })
        : t("filesPanel.unknownError");
    default:
      return null;
  }
};

const toDirectoryAccessError = (error: any): DirectoryAccessError => {
  if (error && typeof error.type === "string") {
    return error as DirectoryAccessError;
  }
  return { type: "unknown", message: error?.message };
};

export const FilesMenu = () => {
  const app = useApp();
  const appState = useExcalidrawAppState();
  const elements = useExcalidrawElements();
  const actionManager = useExcalidrawActionManager();

  const [directoryHandle, setDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [entries, setEntries] = useState<DirectoryFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [directoryError, setDirectoryError] =
    useState<DirectoryAccessError | null>(null);

  const activeFileName = useMemo(() => {
    return appState.fileHandle?.name ?? null;
  }, [appState.fileHandle]);

  const refreshEntries = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setIsLoading(true);
      setDirectoryError(null);
      try {
        const ok = await ensureDirectoryPermission(handle);
        if (!ok) {
          setDirectoryError({ type: "permission" });
          setEntries([]);
          return;
        }
        const list = await listDirectoryEntries(handle);
        setEntries(list);
      } catch (error: any) {
        setDirectoryError(toDirectoryAccessError(error));
        setEntries([]);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // Restore previously selected directory on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadDirectoryHandleFromIDB();
      if (cancelled || !saved) {
        return;
      }
      setDirectoryHandle(saved);
      await refreshEntries(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEntries]);

  const handleSelectFolder = useCallback(async () => {
    setIsLoading(true);
    setDirectoryError(null);
    try {
      const handle = await chooseDirectory();
      if (!handle) {
        // user cancelled
        return;
      }
      setDirectoryHandle(handle);
      await saveDirectoryHandleToIDB(handle);
      await refreshEntries(handle);
    } catch (error: any) {
      setDirectoryError(toDirectoryAccessError(error));
    } finally {
      setIsLoading(false);
    }
  }, [refreshEntries]);

  const handleRefresh = useCallback(async () => {
    if (!directoryHandle) {
      return;
    }
    await refreshEntries(directoryHandle);
  }, [directoryHandle, refreshEntries]);

  const executeAction = useCallback(
    (action: Action) => {
      actionManager.executeAction(action);
    },
    [actionManager],
  );

  const saveSceneToHandle = useCallback(
    async (fileHandle: FileSystemFileHandle) => {
      const elements_ = app.scene.getNonDeletedElements();
      const blob = new Blob(
        [serializeAsJSON(elements_, appState, app.files, "local")],
        { type: MIME_TYPES.excalidraw },
      );
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    [app, appState],
  );

  const handleCreateFile = useCallback(async () => {
    if (!directoryHandle) {
      return;
    }
    const defaultName = t("filesPanel.newFileDefaultName");
    const input = window.prompt(t("filesPanel.newFileNamePrompt"), defaultName);
    if (input === null) {
      return;
    }
    const name = input.trim() || defaultName;
    if (
      app.scene.getNonDeletedElements().length > 0 &&
      !window.confirm(t("filesPanel.confirmNewFileMessage"))
    ) {
      return;
    }
    setIsLoading(true);
    setDirectoryError(null);
    try {
      const ok = await ensureDirectoryPermission(directoryHandle);
      if (!ok) {
        setDirectoryError({ type: "permission" });
        return;
      }
      const fileHandle = await createFileInDirectory(directoryHandle, name);
      // write an empty scene to the new file
      await saveSceneToHandle(fileHandle);
      // clear the canvas for the new file
      executeAction(actionClearCanvas);
      // set the file handle so subsequent saves go to this file
      app.setAppState({
        fileHandle,
        name: fileHandle.name.replace(/\.excalidraw$/, ""),
        lastSavedElementsHash: hashElementsVersion(
          app.scene.getNonDeletedElements(),
        ),
      });
      await saveFileHandleToIDB(fileHandle);
      await refreshEntries(directoryHandle);
    } catch (error: any) {
      setDirectoryError(toDirectoryAccessError(error));
    } finally {
      setIsLoading(false);
    }
  }, [app, directoryHandle, executeAction, refreshEntries, saveSceneToHandle]);

  const handleOpenFile = useCallback(
    async (entry: DirectoryFileEntry) => {
      setIsLoading(true);
      setDirectoryError(null);
      try {
        const ok = await ensureDirectoryPermission(directoryHandle!);
        if (!ok) {
          setDirectoryError({ type: "permission" });
          return;
        }
        const file = await entry.handle.getFile();
        const {
          elements: loadedElements,
          appState: loadedAppState,
          files,
        } = await loadFromBlob(file, appState, elements, entry.handle);
        app.syncActionResult({
          elements: loadedElements,
          appState: {
            ...loadedAppState,
            name:
              loadedAppState.fileHandle?.name?.replace(/\.excalidraw$/, "") ??
              loadedAppState.name,
            lastSavedElementsHash: hashElementsVersion(
              loadedElements.filter((el) => !el.isDeleted),
            ),
          },
          files,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        await saveFileHandleToIDB(entry.handle);
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return;
        }
        setDirectoryError(toDirectoryAccessError(error));
      } finally {
        setIsLoading(false);
      }
    },
    [app, appState, directoryHandle, elements],
  );

  const errorMessage = useMemo(
    () => errorMessageFor(directoryError),
    [directoryError],
  );

  return (
    <div className="layer-ui__files">
      <div className="layer-ui__files-toolbar">
        <span
          className="layer-ui__files-folder-name"
          title={directoryHandle?.name}
        >
          {directoryHandle
            ? t("filesPanel.currentFolder", { name: directoryHandle.name })
            : t("filesPanel.noFolderSelected")}
        </span>
        {directoryHandle && (
          <>
            <button
              type="button"
              className="layer-ui__files-toolbar-btn"
              onClick={handleCreateFile}
              disabled={isLoading || appState.viewModeEnabled}
              title={t("filesPanel.createFile")}
            >
              {filePlusIcon}
            </button>
            <button
              type="button"
              className="layer-ui__files-toolbar-btn"
              onClick={handleRefresh}
              disabled={isLoading}
              title={t("filesPanel.refresh")}
            >
              {refreshIcon}
            </button>
          </>
        )}
        <button
          type="button"
          className="layer-ui__files-toolbar-btn"
          onClick={handleSelectFolder}
          disabled={isLoading}
          title={
            directoryHandle
              ? t("filesPanel.changeFolder")
              : t("filesPanel.selectFolder")
          }
        >
          {folderOpenIcon}
        </button>
      </div>

      {errorMessage && (
        <div className="layer-ui__files-error">{errorMessage}</div>
      )}

      {directoryHandle && (
        <div className="layer-ui__files-section-title">
          {t("labels.filesSectionTitle")}
        </div>
      )}

      <div className="layer-ui__files-list">
        {isLoading ? (
          <div className="layer-ui__files-empty">{t("filesPanel.loading")}</div>
        ) : !directoryHandle ? (
          <div className="layer-ui__files-empty">
            {t("filesPanel.noFolderDescription")}
          </div>
        ) : entries.length === 0 ? (
          <div className="layer-ui__files-empty">
            {t("filesPanel.emptyState")}
          </div>
        ) : (
          entries.map((entry, index) => {
            const isActive = !!activeFileName && entry.name === activeFileName;
            const key = `${entry.name}-${entry.lastModified ?? "na"}-${index}`;
            return (
              <div
                key={key}
                className={`layer-ui__file-item${isActive ? " active" : ""}`}
                title={entry.name}
                onClick={() => handleOpenFile(entry)}
              >
                <span className="layer-ui__file-item-icon">{fileIcon}</span>
                <div className="layer-ui__file-item-body">
                  <span className="layer-ui__file-item-name">{entry.name}</span>
                  <span className="layer-ui__file-item-meta">
                    {t("filesPanel.lastModified", {
                      value: formatTimestamp(entry.lastModified),
                    })}
                  </span>
                </div>
                {isActive && (
                  <span className="layer-ui__file-item-badge">
                    {t("filesPanel.activeBadge")}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
