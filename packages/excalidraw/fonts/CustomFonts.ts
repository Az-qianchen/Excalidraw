import { registerCustomFontFamily } from "@excalidraw/common";

import { Fonts } from "./Fonts";

/**
 * Dynamically registered custom fonts (dropped into the app by the user).
 *
 * Each font is persisted in IndexedDB (raw font data) so that it survives
 * reloads, and registered into `document.fonts` + `Fonts.registered` at
 * startup — no build-time bundling needed.
 *
 * Font-family ids are >= 10_000 so they never collide with built-in
 * families (`FONT_FAMILY`, values 1-10) or fallbacks (100/998/999/1000).
 */

const IDB_NAME = "excalidraw";
const IDB_STORE = "customFonts";
const IDB_VERSION = 2;

/** font files we accept on drop */
const FONT_FILE_EXTENSIONS = /\.(ttf|otf|woff2?|ttc)$/i;

export const isSupportedFontFile = (file: File) =>
  (file.type.startsWith("font/") ||
    file.type === "application/octet-stream" ||
    !file.type) &&
  FONT_FILE_EXTENSIONS.test(file.name);

interface StoredCustomFont {
  /** font-family id used on text elements (`fontFamily`) */
  id: number;
  /** family name used in `FontFace` / UI label */
  family: string;
  /** mime type of the font file */
  type: string;
  /** raw font data */
  data: ArrayBuffer;
}

const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openIDB();
  const tx = db.transaction(IDB_STORE, mode);
  const request = operation(tx.objectStore(IDB_STORE));
  const result = await new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
};

/** fallback for browsers reporting `FontFace` without `family` (e.g. mocks) */
const sanitizeFamilyName = (name: string, fileName: string) =>
  (name || fileName.replace(FONT_FILE_EXTENSIONS, "")).trim() || "Custom font";

/**
 * Registers a dropped font file:
 * 1. creates a `FontFace` from the file blob & adds it to `document.fonts`
 * 2. registers it in the `Fonts` runtime registry & metadata side-registry
 * 3. persists the raw data in IndexedDB for later sessions
 *
 * @returns the font-family id to use on text elements
 */
export const registerCustomFont = async (
  file: File,
  ownerDocument: Document,
): Promise<number> => {
  const data = await file.arrayBuffer();

  // the browser parses the font and exposes its real family name
  const fontFace = new FontFace(
    file.name.replace(FONT_FILE_EXTENSIONS, ""),
    data,
    {
      display: "swap",
    },
  );
  await fontFace.load();
  ownerDocument.fonts.add(fontFace);

  const family = sanitizeFamilyName(
    (fontFace as unknown as { family?: string }).family ?? "",
    file.name,
  );

  // allocate a fresh id, never colliding with persisted or built-in ids
  const existing = await listCustomFonts();
  const maxId = existing.reduce((max, font) => Math.max(max, font.id), 9_999);
  const id = maxId + 1;

  registerCustomFontFamily(id, family);
  Fonts.registerCustomFont(id, family, fontFace);

  try {
    await withStore("readwrite", (store) =>
      store.put(
        {
          id,
          family,
          type: file.type || "font/ttf",
          data,
        } as StoredCustomFont,
        id,
      ),
    );
  } catch (e) {
    // persisting is best-effort; the font still works this session
    console.warn("Failed to persist custom font", e);
  }

  return id;
};

/**
 * Re-registers all previously persisted custom fonts (on app startup).
 *
 * @returns the number of restored fonts
 */
export const restoreCustomFonts = async (
  ownerDocument: Document,
): Promise<number> => {
  let fonts: StoredCustomFont[];
  try {
    fonts = await withStore(
      "readonly",
      (store) => store.getAll() as IDBRequest<StoredCustomFont[]>,
    );
  } catch {
    return 0;
  }

  for (const font of fonts) {
    try {
      const fontFace = new FontFace(font.family, font.data, {
        display: "swap",
      });
      await fontFace.load();
      ownerDocument.fonts.add(fontFace);
      registerCustomFontFamily(font.id, font.family);
      Fonts.registerCustomFont(font.id, font.family, fontFace);
    } catch (e) {
      console.warn(`Failed to restore custom font "${font.family}"`, e);
    }
  }

  return fonts.length;
};

/** lists persisted custom fonts (without loading them) */
export const listCustomFonts = async (): Promise<
  Array<{ id: number; family: string }>
> => {
  try {
    const fonts = await withStore(
      "readonly",
      (store) => store.getAll() as IDBRequest<StoredCustomFont[]>,
    );
    return fonts.map(({ id, family }) => ({ id, family }));
  } catch {
    return [];
  }
};

/** deletes a persisted custom font */
export const deleteCustomFont = async (id: number) => {
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch (e) {
    console.warn("Failed to delete custom font", e);
  }
};
