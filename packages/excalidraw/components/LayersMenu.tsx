import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { KEYS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getElementsInGroup,
  isFrameLikeElement,
  isTextElement,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { t } from "../i18n";

import {
  useApp,
  useExcalidrawAppState,
  useExcalidrawElements,
  useExcalidrawSetAppState,
} from "./App";
import {
  chevronDownIcon,
  DiamondIcon,
  EllipseIcon,
  eyeClosedIcon,
  eyeIcon,
  FreedrawIcon,
  frameToolIcon,
  groupLayersIcon,
  ImageIcon,
  LineIcon,
  ArrowIcon,
  LockedIcon,
  RectangleIcon,
  TextIcon,
  TrashIcon,
  UnlockedIcon,
  EmbedIcon,
} from "./icons";

import "./LayersMenu.scss";

const TYPE_ICON: Record<NonDeletedExcalidrawElement["type"], React.ReactNode> =
  {
    rectangle: RectangleIcon,
    diamond: DiamondIcon,
    ellipse: EllipseIcon,
    text: TextIcon,
    line: LineIcon,
    arrow: ArrowIcon,
    freedraw: FreedrawIcon,
    image: ImageIcon,
    frame: frameToolIcon,
    magicframe: frameToolIcon,
    iframe: EmbedIcon,
    embeddable: EmbedIcon,
    selection: RectangleIcon,
  };

const getElementName = (element: NonDeletedExcalidrawElement): string => {
  if (isFrameLikeElement(element) && element.name) {
    return element.name;
  }
  if (isTextElement(element)) {
    const text = element.text.trim();
    if (text) {
      return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    }
    return t("layerItem.rename");
  }
  const customName = (element.customData as { name?: string } | undefined)
    ?.name;
  if (customName) {
    return customName;
  }
  return (t(`element.${element.type}` as any) as string) || element.type;
};

const GROUP_NAMES_KEY = "excalidraw_group_names";

const loadGroupNames = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(GROUP_NAMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveGroupNameToStorage = (groupId: string, name: string) => {
  try {
    const all = loadGroupNames();
    if (name) {
      all[groupId] = name;
    } else {
      delete all[groupId];
    }
    localStorage.setItem(GROUP_NAMES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
};

const getGroupName = (groupId: string): string => {
  const names = loadGroupNames();
  return names[groupId] || "";
};

const isElementHidden = (el: { isDeleted: boolean; customData?: any }) =>
  el.isDeleted && el.customData?.hidden === true;

type DropPosition = "above" | "below" | "inside";

type LayerNode =
  | { kind: "element"; element: NonDeletedExcalidrawElement; level: number }
  | {
      kind: "group";
      groupId: string;
      level: number;
      isCollapsed: boolean;
      elementCount: number;
    };

const buildLayerNodes = (
  elements: readonly NonDeletedExcalidrawElement[],
  collapsedGroups: Set<string>,
): LayerNode[] => {
  const reversed = [...elements];

  const buildLevel = (
    els: NonDeletedExcalidrawElement[],
    level: number,
  ): LayerNode[] => {
    const result: LayerNode[] = [];
    const groupElementsMap = new Map<string, NonDeletedExcalidrawElement[]>();
    const emittedGroups = new Set<string>();

    for (const el of els) {
      if (el.groupIds.length > level) {
        const gid = el.groupIds[level];
        if (!groupElementsMap.has(gid)) {
          groupElementsMap.set(gid, []);
        }
        groupElementsMap.get(gid)!.push(el);
      }
    }

    for (const el of els) {
      if (el.groupIds.length > level) {
        const gid = el.groupIds[level];
        if (!emittedGroups.has(gid)) {
          emittedGroups.add(gid);
          const isCollapsed = collapsedGroups.has(gid);
          const groupEls = groupElementsMap.get(gid)!;
          result.push({
            kind: "group",
            groupId: gid,
            level,
            isCollapsed,
            elementCount: groupEls.length,
          });
          if (!isCollapsed) {
            result.push(...buildLevel(groupEls, level + 1));
          }
        }
      } else {
        result.push({ kind: "element", element: el, level });
      }
    }

    return result;
  };

  return buildLevel(reversed, 0);
};

export const LayersMenu = () => {
  const app = useApp();
  const appState = useExcalidrawAppState();
  const setAppState = useExcalidrawSetAppState();
  const visibleElements = useExcalidrawElements();

  // Show: visible + hidden elements. Exclude: truly deleted.
  const elements = useMemo(
    () =>
      (
        app.scene.getElementsIncludingDeleted() as NonDeletedExcalidrawElement[]
      ).filter((el) => !el.isDeleted || el.customData?.hidden === true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, visibleElements],
  );

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: DropPosition;
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [groupNamesVersion, setGroupNamesVersion] = useState(0);

  const lastSelectedIdRef = useRef<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // silence unused — version triggers re-render for group name refresh
  void groupNamesVersion;

  const layerNodes = useMemo(
    () => buildLayerNodes(elements, collapsedGroups),
    [elements, collapsedGroups],
  );

  const visibleNodeIds = useMemo(
    () =>
      layerNodes
        .filter((n) => n.kind === "element")
        .map((n) => (n as Extract<LayerNode, { kind: "element" }>).element.id),
    [layerNodes],
  );

  const selectedElementIds = appState.selectedElementIds;

  // ---- helper: mutate elements and trigger re-render ----
  const mutateAndSync = useCallback(
    (mutateFn: () => void) => {
      mutateFn();
      const nextElements = app.scene.getElementsIncludingDeleted();
      app.syncActionResult({
        elements: nextElements,
        appState: null,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [app],
  );

  const setSelectedIds = useCallback(
    (ids: string[]) => {
      setAppState({
        selectedElementIds: ids.reduce(
          (acc, id) => ({ ...acc, [id]: true }),
          {} as { [id: string]: true },
        ),
        selectedGroupIds: {},
      });
    },
    [setAppState],
  );

  const selectGroup = useCallback(
    (groupId: string) => {
      const groupEls = getElementsInGroup(
        app.scene.getElementsMapIncludingDeleted(),
        groupId,
      );
      setSelectedIds(groupEls.map((el) => el.id));
      lastSelectedIdRef.current = null;
    },
    [app, setSelectedIds],
  );

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const toggleGroupLock = useCallback(
    (groupId: string) => {
      mutateAndSync(() => {
        const groupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          groupId,
        ) as NonDeletedExcalidrawElement[];
        if (groupEls.length === 0) {
          return;
        }
        const allLocked = groupEls.every((el) => el.locked);
        groupEls.forEach((el) => {
          app.scene.mutateElement(
            el,
            { locked: !allLocked },
            { informMutation: true, isDragging: false },
          );
        });
      });
    },
    [app, mutateAndSync],
  );

  const toggleGroupVisibility = useCallback(
    (groupId: string) => {
      mutateAndSync(() => {
        const groupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          groupId,
        ) as NonDeletedExcalidrawElement[];
        if (groupEls.length === 0) {
          return;
        }
        const allHidden = groupEls.every((el) => isElementHidden(el));
        groupEls.forEach((el) => {
          const customData =
            (el.customData as Record<string, any> | undefined) ?? {};
          if (!allHidden) {
            // hide
            app.scene.mutateElement(
              el,
              { isDeleted: true, customData: { ...customData, hidden: true } },
              { informMutation: true, isDragging: false },
            );
          } else {
            // show
            const { hidden: _h, ...rest } = customData;
            app.scene.mutateElement(
              el,
              { isDeleted: false, customData: rest },
              { informMutation: true, isDragging: false },
            );
          }
        });
      });
    },
    [app, mutateAndSync],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      mutateAndSync(() => {
        const groupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          groupId,
        ) as NonDeletedExcalidrawElement[];
        groupEls.forEach((el) => {
          const customData =
            (el.customData as Record<string, any> | undefined) ?? {};
          const { hidden: _h, ...rest } = customData;
          app.scene.mutateElement(
            el,
            { isDeleted: true, customData: rest },
            { informMutation: true, isDragging: false },
          );
        });
      });
      // clean up selection
      const nextSelectedIds: { [id: string]: true } = {};
      const groupEls = getElementsInGroup(
        app.scene.getElementsMapIncludingDeleted(),
        groupId,
      );
      const groupElIds = new Set(groupEls.map((el) => el.id));
      for (const selectedId of Object.keys(selectedElementIds)) {
        if (!groupElIds.has(selectedId)) {
          nextSelectedIds[selectedId] = true;
        }
      }
      setAppState({
        selectedElementIds: nextSelectedIds,
        selectedGroupIds: {},
      });
    },
    [app, mutateAndSync, selectedElementIds, setAppState],
  );

  const startEditingGroup = useCallback((groupId: string) => {
    setEditingId(`group:${groupId}`);
    setEditingValue(getGroupName(groupId));
  }, []);

  const commitEditingGroup = useCallback(() => {
    if (!editingId || !editingId.startsWith("group:")) {
      return;
    }
    const groupId = editingId.slice(6);
    saveGroupNameToStorage(groupId, editingValue.trim());
    setGroupNamesVersion((v) => v + 1);
    setEditingId(null);
    setEditingValue("");
  }, [editingId, editingValue]);

  const cancelEditingGroup = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
  }, []);

  const handleLayerClick = useCallback(
    (element: NonDeletedExcalidrawElement, event: React.MouseEvent) => {
      const id = element.id;
      if (event[KEYS.CTRL_OR_CMD]) {
        const nextSelectedIds: { [id: string]: true } = {};
        for (const selectedId of Object.keys(selectedElementIds)) {
          if (selectedId !== id) {
            nextSelectedIds[selectedId] = true;
          }
        }
        if (!selectedElementIds[id]) {
          nextSelectedIds[id] = true;
        }
        setAppState({
          selectedElementIds: nextSelectedIds,
          selectedGroupIds: {},
        });
        lastSelectedIdRef.current = id;
      } else if (event.shiftKey) {
        const anchorId = lastSelectedIdRef.current;
        if (anchorId) {
          const anchorIdx = visibleNodeIds.indexOf(anchorId);
          const currentIdx = visibleNodeIds.indexOf(id);
          if (anchorIdx !== -1 && currentIdx !== -1) {
            const from = Math.min(anchorIdx, currentIdx);
            const to = Math.max(anchorIdx, currentIdx);
            const rangeIds = visibleNodeIds.slice(from, to + 1);
            setSelectedIds([...Object.keys(selectedElementIds), ...rangeIds]);
            return;
          }
        }
        setSelectedIds([id]);
        lastSelectedIdRef.current = id;
      } else {
        setSelectedIds([id]);
        lastSelectedIdRef.current = id;
      }
    },
    [selectedElementIds, setAppState, setSelectedIds, visibleNodeIds],
  );

  const toggleLock = useCallback(
    (element: NonDeletedExcalidrawElement) => {
      mutateAndSync(() => {
        app.scene.mutateElement(
          element,
          { locked: !element.locked },
          { informMutation: true, isDragging: false },
        );
      });
    },
    [app, mutateAndSync],
  );

  const toggleVisibility = useCallback(
    (element: NonDeletedExcalidrawElement) => {
      mutateAndSync(() => {
        const hidden = isElementHidden(element);
        const customData =
          (element.customData as Record<string, any> | undefined) ?? {};
        if (!hidden) {
          app.scene.mutateElement(
            element,
            { isDeleted: true, customData: { ...customData, hidden: true } },
            { informMutation: true, isDragging: false },
          );
        } else {
          const { hidden: _h, ...rest } = customData;
          app.scene.mutateElement(
            element,
            { isDeleted: false, customData: rest },
            { informMutation: true, isDragging: false },
          );
        }
      });
    },
    [app, mutateAndSync],
  );

  const deleteElement = useCallback(
    (element: NonDeletedExcalidrawElement) => {
      mutateAndSync(() => {
        const customData =
          (element.customData as Record<string, any> | undefined) ?? {};
        const { hidden: _h, ...rest } = customData;
        app.scene.mutateElement(
          element,
          { isDeleted: true, customData: rest },
          { informMutation: true, isDragging: false },
        );
      });
      const nextSelectedIds: { [id: string]: true } = {};
      for (const selectedId of Object.keys(selectedElementIds)) {
        if (selectedId !== element.id) {
          nextSelectedIds[selectedId] = true;
        }
      }
      setAppState({ selectedElementIds: nextSelectedIds });
    },
    [app, mutateAndSync, selectedElementIds, setAppState],
  );

  const startEditing = useCallback((element: NonDeletedExcalidrawElement) => {
    const currentName =
      (element.customData as { name?: string } | undefined)?.name ?? "";
    setEditingId(element.id);
    setEditingValue(currentName);
  }, []);

  const commitEditing = useCallback(() => {
    if (!editingId || editingId.startsWith("group:")) {
      return;
    }
    mutateAndSync(() => {
      const element = app.scene.getElement(editingId);
      if (element) {
        const trimmed = editingValue.trim();
        const currentCustomData =
          (element.customData as { name?: string } | undefined) ?? {};
        const nextCustomData = trimmed
          ? { ...currentCustomData, name: trimmed }
          : (() => {
              const { name: _name, ...rest } = currentCustomData;
              return rest;
            })();
        app.scene.mutateElement(
          element,
          { customData: nextCustomData },
          { informMutation: true, isDragging: false },
        );
      }
    });
    setEditingId(null);
    setEditingValue("");
  }, [app, mutateAndSync, editingId, editingValue]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ---- reordering (elements + groups + drag into group) ----

  const reorderElements = useCallback(
    (
      draggedId: string,
      targetId: string,
      position: DropPosition,
      isDraggedGroup: boolean,
      isTargetGroup: boolean,
    ) => {
      const allElements = app.scene.getElementsIncludingDeleted();

      // ---- GROUP dragged ----
      if (isDraggedGroup) {
        const draggedGroupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          draggedId,
        );
        if (draggedGroupEls.length === 0) {
          return;
        }
        // Find the nesting level of the dragged group in its elements' groupIds
        const draggedLevel = draggedGroupEls[0].groupIds.indexOf(draggedId);
        if (draggedLevel === -1) {
          return;
        }
        // Get ALL elements at this nesting level that belong to the dragged group
        // (includes nested sub-group elements since they share this prefix)
        const allAtLevel = allElements.filter(
          (e) =>
            e.groupIds.length > draggedLevel &&
            e.groupIds[draggedLevel] === draggedId,
        );
        const draggedIds = new Set(allAtLevel.map((e) => e.id));

        if (position === "inside") {
          // Drag group into another group
          const targetGroupEls = getElementsInGroup(
            app.scene.getElementsMapIncludingDeleted(),
            targetId,
          );
          if (targetGroupEls.length > 0) {
            const targetGroupIds = targetGroupEls[0].groupIds;
            const targetGroupLevel = targetGroupIds.indexOf(targetId);
            const newGroupIds = targetGroupIds.slice(0, targetGroupLevel + 1);
            mutateAndSync(() => {
              for (const el of allAtLevel) {
                app.scene.mutateElement(
                  el,
                  { groupIds: newGroupIds },
                  { informMutation: true, isDragging: false },
                );
              }
            });
          }
          return;
        }

        // above/below: move entire group in the array
        const remaining = allElements.filter((e) => !draggedIds.has(e.id));
        let anchorEl: NonDeletedExcalidrawElement | undefined;
        if (isTargetGroup) {
          const targetGroupEls = getElementsInGroup(
            app.scene.getElementsMapIncludingDeleted(),
            targetId,
          );
          anchorEl = targetGroupEls[0];
        } else {
          anchorEl = remaining.find((e) => e.id === targetId);
        }
        if (!anchorEl) {
          return;
        }
        let targetIdx = remaining.findIndex((e) => e.id === anchorEl.id);
        if (targetIdx === -1) {
          return;
        }
        if (position === "below") {
          targetIdx += 1;
        }
        const newOrdered = [
          ...remaining.slice(0, targetIdx),
          ...allAtLevel,
          ...remaining.slice(targetIdx),
        ];
        app.scene.replaceAllElements(newOrdered);
        app.syncActionResult({
          elements: newOrdered,
          appState: null,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return;
      }

      // ---- ELEMENT dragged ----
      const dragged = allElements.find((e) => e.id === draggedId);
      if (!dragged) {
        return;
      }

      if (position === "inside") {
        // Drag element into a group (targetId is a group ID)
        const targetGroupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          targetId,
        );
        if (targetGroupEls.length > 0) {
          const targetGroupIds = targetGroupEls[0].groupIds;
          const targetGroupLevel = targetGroupIds.indexOf(targetId);
          const newGroupIds = targetGroupIds.slice(0, targetGroupLevel + 1);
          mutateAndSync(() => {
            app.scene.mutateElement(
              dragged,
              { groupIds: newGroupIds },
              { informMutation: true, isDragging: false },
            );
          });
        }
        return;
      }

      // above/below reorder
      const remaining = allElements.filter((e) => e.id !== draggedId);
      let targetIdx: number;
      if (isTargetGroup) {
        // Target is a group: find its anchor element (first in array)
        const targetGroupEls = getElementsInGroup(
          app.scene.getElementsMapIncludingDeleted(),
          targetId,
        );
        const anchorEl = targetGroupEls[0];
        if (!anchorEl) {
          return;
        }
        targetIdx = remaining.findIndex((e) => e.id === anchorEl.id);
        if (targetIdx === -1) {
          return;
        }
      } else {
        targetIdx = remaining.findIndex((e) => e.id === targetId);
        if (targetIdx === -1) {
          return;
        }
      }
      if (position === "above") {
        targetIdx = targetIdx + 1;
      }
      const newOrdered = [
        ...remaining.slice(0, targetIdx),
        dragged,
        ...remaining.slice(targetIdx),
      ];
      app.scene.replaceAllElements(newOrdered);
      app.syncActionResult({
        elements: newOrdered,
        appState: null,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [app, mutateAndSync],
  );

  // Track what kind of item is being dragged
  const [draggedKind, setDraggedKind] = useState<"element" | "group" | null>(
    null,
  );

  const handleDragStart = useCallback(
    (
      event: React.DragEvent<HTMLDivElement>,
      id: string,
      kind: "element" | "group",
    ) => {
      setDraggedId(id);
      setDraggedKind(kind);
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDraggedKind(null);
    setDropTarget(null);
  }, []);

  const computeDropPosition = (
    event: React.DragEvent<HTMLDivElement>,
    isGroup: boolean,
  ): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    if (isGroup) {
      // For groups: top 30% = above, bottom 30% = below, middle 40% = inside
      if (offset < rect.height * 0.3) {
        return "above";
      }
      if (offset > rect.height * 0.7) {
        return "below";
      }
      return "inside";
    }
    return offset < rect.height / 2 ? "above" : "below";
  };

  const handleItemDragOver = useCallback(
    (
      event: React.DragEvent<HTMLDivElement>,
      targetId: string,
      isGroup: boolean,
    ) => {
      if (!draggedId || draggedId === targetId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const position = computeDropPosition(event, isGroup);
      setDropTarget((prev) =>
        prev && prev.id === targetId && prev.position === position
          ? prev
          : { id: targetId, position },
      );
    },
    [draggedId],
  );

  const handleDrop = useCallback(
    (
      event: React.DragEvent<HTMLDivElement>,
      targetId: string,
      isTargetGroup: boolean,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (!draggedId || draggedId === targetId) {
        return;
      }
      const position = computeDropPosition(event, isTargetGroup);
      reorderElements(
        draggedId,
        targetId,
        position,
        draggedKind === "group",
        isTargetGroup,
      );
      setDraggedId(null);
      setDraggedKind(null);
      setDropTarget(null);
    },
    [draggedId, draggedKind, reorderElements],
  );

  // Handle drop on the list container (not on any item)
  const handleListDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!draggedId) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    [draggedId],
  );

  const handleListDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      // Dropped on blank area — clear drop target, no reorder
      setDraggedId(null);
      setDraggedKind(null);
      setDropTarget(null);
    },
    [],
  );

  const hasElements = layerNodes.length > 0;

  useEffect(() => {
    return () => {
      setDraggedId(null);
      setDropTarget(null);
    };
  }, []);

  return (
    <div className="layer-ui__layers">
      <div
        className="layer-ui__layers-list"
        onDragOver={handleListDragOver}
        onDrop={handleListDrop}
      >
        {!hasElements ? (
          <div className="layer-ui__layers-empty">{t("layersPanel.empty")}</div>
        ) : (
          layerNodes.map((node) => {
            if (node.kind === "group") {
              const isGroupSelected = !!appState.selectedGroupIds[node.groupId];
              const isDropAbove =
                dropTarget?.id === node.groupId &&
                dropTarget.position === "above";
              const isDropBelow =
                dropTarget?.id === node.groupId &&
                dropTarget.position === "below";
              const isDropInside =
                dropTarget?.id === node.groupId &&
                dropTarget.position === "inside";
              const groupEls = getElementsInGroup(
                app.scene.getElementsMapIncludingDeleted(),
                node.groupId,
              ) as NonDeletedExcalidrawElement[];
              const isGroupLocked = groupEls.every((el) => el.locked);
              const isGroupHidden = groupEls.every((el) => isElementHidden(el));
              const isEditingGroup = editingId === `group:${node.groupId}`;
              const groupDisplayName = getGroupName(node.groupId);
              return (
                <div
                  key={`group-${node.groupId}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, node.groupId, "group")}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleItemDragOver(e, node.groupId, true)}
                  onDrop={(e) => handleDrop(e, node.groupId, true)}
                  onClick={() => selectGroup(node.groupId)}
                  className={clsx(
                    "layer-ui__layer-item",
                    "layer-ui__layer-group",
                    {
                      active: isGroupSelected,
                      collapsed: node.isCollapsed,
                      locked: isGroupLocked,
                      hidden: isGroupHidden,
                      "drop-inside": isDropInside,
                      dragging: draggedId === node.groupId,
                    },
                  )}
                  style={{ paddingLeft: 8 + node.level * 16 }}
                  title={t("layersPanel.group")}
                >
                  {isDropAbove && (
                    <div className="layer-ui__layer-drop-indicator" />
                  )}
                  <div className="layer-ui__layer-item-row">
                    <button
                      type="button"
                      className={clsx(
                        "layer-ui__layer-collapse-btn",
                        node.isCollapsed &&
                          "layer-ui__layer-collapse-btn--collapsed",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGroupCollapse(node.groupId);
                      }}
                      title={
                        node.isCollapsed
                          ? t("layerItem.expand")
                          : t("layerItem.collapse")
                      }
                    >
                      {chevronDownIcon}
                    </button>
                    <span className="layer-ui__layer-icon">
                      {groupLayersIcon}
                    </span>
                    {isEditingGroup ? (
                      <input
                        ref={editInputRef}
                        className="layer-ui__layer-name-input"
                        value={editingValue}
                        placeholder={t("layersPanel.group")}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={commitEditingGroup}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitEditingGroup();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditingGroup();
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="layer-ui__layer-name"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEditingGroup(node.groupId);
                        }}
                      >
                        {groupDisplayName
                          ? groupDisplayName
                          : t("layersPanel.group")}
                      </span>
                    )}
                    <div className="layer-ui__layer-actions">
                      <button
                        type="button"
                        className="layer-ui__layer-action-btn"
                        title={
                          isGroupLocked
                            ? t("layerItem.unlock")
                            : t("layerItem.lock")
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupLock(node.groupId);
                        }}
                      >
                        {isGroupLocked ? LockedIcon : UnlockedIcon}
                      </button>
                      <button
                        type="button"
                        className="layer-ui__layer-action-btn"
                        title={
                          isGroupHidden
                            ? t("layerItem.show")
                            : t("layerItem.hide")
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupVisibility(node.groupId);
                        }}
                      >
                        {isGroupHidden ? eyeClosedIcon : eyeIcon}
                      </button>
                      <button
                        type="button"
                        className="layer-ui__layer-action-btn layer-ui__layer-action-btn--danger"
                        title={t("layerItem.delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup(node.groupId);
                        }}
                      >
                        {TrashIcon}
                      </button>
                    </div>
                  </div>
                  {isDropBelow && (
                    <div className="layer-ui__layer-drop-indicator" />
                  )}
                </div>
              );
            }

            const element = node.element;
            const isSelected = !!selectedElementIds[element.id];
            const isLocked = element.locked;
            const isHidden = isElementHidden(element);
            const icon = TYPE_ICON[element.type] ?? RectangleIcon;
            const isDropAbove =
              dropTarget?.id === element.id && dropTarget.position === "above";
            const isDropBelow =
              dropTarget?.id === element.id && dropTarget.position === "below";
            const isEditing = editingId === element.id;

            return (
              <div
                key={element.id}
                draggable={!isLocked && !isEditing}
                onDragStart={(e) => handleDragStart(e, element.id, "element")}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleItemDragOver(e, element.id, false)}
                onDrop={(e) => handleDrop(e, element.id, false)}
                onClick={(e) => handleLayerClick(element, e)}
                className={clsx("layer-ui__layer-item", {
                  active: isSelected,
                  locked: isLocked,
                  hidden: isHidden,
                  dragging: draggedId === element.id,
                })}
                style={{ paddingLeft: 8 + node.level * 16 }}
                title={t("layerItem.tooltipSelectDrag")}
              >
                {isDropAbove && (
                  <div className="layer-ui__layer-drop-indicator" />
                )}
                <div className="layer-ui__layer-item-row">
                  {node.level > 0 && (
                    <span className="layer-ui__layer-indent-spacer" />
                  )}
                  <span className="layer-ui__layer-icon">{icon}</span>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="layer-ui__layer-name-input"
                      value={editingValue}
                      placeholder={getElementName(element)}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={commitEditing}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEditing();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditing();
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="layer-ui__layer-name"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditing(element);
                      }}
                    >
                      {getElementName(element)}
                    </span>
                  )}
                  <div className="layer-ui__layer-actions">
                    <button
                      type="button"
                      className="layer-ui__layer-action-btn"
                      title={
                        isLocked ? t("layerItem.unlock") : t("layerItem.lock")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLock(element);
                      }}
                    >
                      {isLocked ? LockedIcon : UnlockedIcon}
                    </button>
                    <button
                      type="button"
                      className="layer-ui__layer-action-btn"
                      title={
                        isHidden ? t("layerItem.show") : t("layerItem.hide")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVisibility(element);
                      }}
                    >
                      {isHidden ? eyeClosedIcon : eyeIcon}
                    </button>
                    <button
                      type="button"
                      className="layer-ui__layer-action-btn layer-ui__layer-action-btn--danger"
                      title={t("layerItem.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteElement(element);
                      }}
                    >
                      {TrashIcon}
                    </button>
                  </div>
                </div>
                {isDropBelow && (
                  <div className="layer-ui__layer-drop-indicator" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
