import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from "browser-fs-access";

import { MIME_TYPES } from "@excalidraw/common";

import { normalizeFile } from "./blob";

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, "binary">;

export const fileOpen = async <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === "jpg") {
      return acc.concat(".jpg", ".jpeg");
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  const files = await _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  });

  if (Array.isArray(files)) {
    return (await Promise.all(
      files.map((file) => normalizeFile(file)),
    )) as RetType;
  }
  return (await normalizeFile(files)) as RetType;
};

export const fileSave = (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
    /** existing FileSystemFileHandle */
    fileHandle?: FileSystemFileHandle | null;
  },
) => {
  return _fileSave(
    blob,
    {
      fileName: `${opts.name}.${opts.extension}`,
      description: opts.description,
      extensions: [`.${opts.extension}`],
      mimeTypes: opts.mimeTypes,
    },
    opts.fileHandle,
    false,
  );
};

const IDB_NAME = "excalidraw";
const IDB_STORE = "fileHandles";
const IDB_KEY = "activeFileHandle";

const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveFileHandleToIDB = async (
  handle: FileSystemFileHandle | null,
): Promise<void> => {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (handle) {
      store.put(handle, IDB_KEY);
    } else {
      store.delete(IDB_KEY);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save file handle to IndexedDB", e);
  }
};

export const loadFileHandleFromIDB =
  async (): Promise<FileSystemFileHandle | null> => {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const request = store.get(IDB_KEY);
      const handle: FileSystemFileHandle | undefined = await new Promise(
        (resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return handle ?? null;
    } catch {
      return null;
    }
  };
interface FileSystemFileHandleWithPermission extends FileSystemFileHandle {
  queryPermission(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

export const ensureFileHandlePermission = async (
  handle: FileSystemFileHandle,
): Promise<boolean> => {
  try {
    const handleWithPermission = handle as FileSystemFileHandleWithPermission;
    const descriptor = { mode: "readwrite" as const };
    let permission = await handleWithPermission.queryPermission(descriptor);
    if (permission === "granted") {
      return true;
    }
    permission = await handleWithPermission.requestPermission(descriptor);
    return permission === "granted";
  } catch {
    return false;
  }
};

// ----------------------- directory handling ---------------------------------

const DIR_IDB_KEY = "activeDirectoryHandle";

export type DirectoryAccessError =
  | { type: "unsupported" }
  | { type: "permission" }
  | { type: "unknown"; message?: string };

export interface DirectoryFileEntry {
  name: string;
  handle: FileSystemFileHandle;
  lastModified?: number;
  size?: number;
}

interface FileSystemDirectoryHandleWithPermission
  extends FileSystemDirectoryHandle {
  queryPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

const EXCALIDRAW_EXT_RE = /\.excalidraw$/i;

class DirectoryAccessErrorImpl extends Error {
  type: DirectoryAccessError["type"];
  constructor(error: DirectoryAccessError) {
    const msg =
      error.type === "unknown" ? error.message ?? error.type : error.type;
    super(msg);
    this.name = "DirectoryAccessError";
    this.type = error.type;
  }
}

const throwDirectoryError = (error: DirectoryAccessError): never => {
  throw new DirectoryAccessErrorImpl(error);
};

/**
 * Opens a directory picker and returns the selected `FileSystemDirectoryHandle`.
 * Returns `null` if the user cancels the picker.
 */
export const chooseDirectory =
  async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!nativeFileSystemSupported) {
      throwDirectoryError({ type: "unsupported" });
    }
    // `window.showDirectoryPicker` is not part of the TS lib defs yet.
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts?: {
          mode?: "read" | "readwrite";
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      throwDirectoryError({ type: "unsupported" });
    }
    try {
      const handle = await picker!({ mode: "readwrite" });
      return handle;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return null;
      }
      if (error instanceof DirectoryAccessErrorImpl) {
        throw error;
      }
      throwDirectoryError({
        type: "unknown",
        message: error?.message,
      });
    }
    return null;
  };

export const ensureDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
): Promise<boolean> => {
  try {
    const handleWithPermission =
      handle as FileSystemDirectoryHandleWithPermission;
    if (!handleWithPermission.queryPermission) {
      return true;
    }
    const descriptor = { mode: "readwrite" as const };
    let permission = await handleWithPermission.queryPermission(descriptor);
    if (permission === "granted") {
      return true;
    }
    if (!handleWithPermission.requestPermission) {
      return false;
    }
    permission = await handleWithPermission.requestPermission(descriptor);
    return permission === "granted";
  } catch {
    return false;
  }
};

/**
 * Iterates the directory and returns all `.excalidraw` files, sorted by
 * `lastModified` descending (most recently modified first).
 */
export const listDirectoryEntries = async (
  dirHandle: FileSystemDirectoryHandle,
): Promise<DirectoryFileEntry[]> => {
  const entries: DirectoryFileEntry[] = [];
  // @ts-expect-error `values()` is part of the FS Access API but not in lib.dom
  for await (const handle of dirHandle.values()) {
    if (handle.kind === "file" && EXCALIDRAW_EXT_RE.test(handle.name)) {
      let lastModified: number | undefined;
      let size: number | undefined;
      try {
        const file = await handle.getFile();
        lastModified = file.lastModified;
        size = file.size;
      } catch {
        // ignore files that can't be read
      }
      entries.push({ name: handle.name, handle, lastModified, size });
    }
  }
  entries.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  return entries;
};

/**
 * Creates a new `.excalidraw` file inside the given directory. If a file with
 * the same name already exists it will be overwritten.
 */
export const createFileInDirectory = async (
  dirHandle: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle> => {
  const filename = name.endsWith(".excalidraw") ? name : `${name}.excalidraw`;
  return await dirHandle.getFileHandle(filename, { create: true });
};

export const saveDirectoryHandleToIDB = async (
  handle: FileSystemDirectoryHandle | null,
): Promise<void> => {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (handle) {
      store.put(handle, DIR_IDB_KEY);
    } else {
      store.delete(DIR_IDB_KEY);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save directory handle to IndexedDB", e);
  }
};

export const loadDirectoryHandleFromIDB =
  async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const request = store.get(DIR_IDB_KEY);
      const handle: FileSystemDirectoryHandle | undefined = await new Promise(
        (resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return handle ?? null;
    } catch {
      return null;
    }
  };

export { nativeFileSystemSupported };
