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
    const handleWithPermission =
      handle as FileSystemFileHandleWithPermission;
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

export { nativeFileSystemSupported };
