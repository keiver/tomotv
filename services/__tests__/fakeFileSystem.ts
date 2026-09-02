/**
 * In-memory stand-in for expo-file-system, for the downloads suite.
 *
 * Its own module because a jest.mock factory runs while the test file's own class
 * declarations are still uninitialised; requiring a module from inside the factory
 * evaluates it in full instead.
 */

type Node = { isDirectory: boolean; content: string; size: number };

export const fakeFs = new Map<string, Node>();

/** Resolves the constructor's (Directory | File | string)[] the way expo-file-system does. */
function join(parts: unknown[]): string {
  const raw = parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  const [scheme, ...rest] = raw.split("://");
  // Collapse repeated separators in the path only; the scheme's own `//` has to survive.
  return rest.length === 0 ? raw.replace(/\/{2,}/g, "/") : `${scheme}://${rest.join("://").replace(/\/{2,}/g, "/")}`;
}

export class Directory {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = join(parts);
  }
  get exists() {
    return fakeFs.get(this.uri)?.isDirectory === true;
  }
  create() {
    fakeFs.set(this.uri, { isDirectory: true, content: "", size: 0 });
  }
  delete() {
    for (const key of [...fakeFs.keys()]) if (key === this.uri || key.startsWith(`${this.uri}/`)) fakeFs.delete(key);
  }
}

export class File {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = join(parts);
  }
  get exists() {
    return fakeFs.get(this.uri)?.isDirectory === false;
  }
  get size() {
    return fakeFs.get(this.uri)?.size ?? 0;
  }
  write(content: string) {
    fakeFs.set(this.uri, { isDirectory: false, content, size: content.length });
  }
  async text() {
    return fakeFs.get(this.uri)?.content ?? "";
  }
  delete() {
    fakeFs.delete(this.uri);
  }

  static createDownloadTask = jest.fn();
  static downloadFileAsync = jest.fn(async (_url: string, destination: File) => {
    destination.write("poster-bytes");
    return destination;
  });
}

export const Paths = { document: { uri: "file:///doc" }, cache: { uri: "file:///cache" }, availableDiskSpace: Number.MAX_SAFE_INTEGER };
export const DownloadTask = { fromSavable: jest.fn() };

/** A transfer the test drives: nothing completes until it says so. */
export class FakeTask {
  settle!: (file: File | null) => void;
  reject!: (error: Error) => void;
  private promise: Promise<File | null>;
  cancel = jest.fn();
  savable = jest.fn(() => ({ url: "u", fileUri: this.destination.uri, isDirectory: false, resumeData: "r" }));

  constructor(
    public destination: File,
    public options: { onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void },
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.settle = resolve;
      this.reject = reject;
    });
  }
  downloadAsync() {
    return this.promise;
  }
  resumeAsync() {
    return this.promise;
  }
  async pauseAsync() {
    this.settle(null);
  }
  /** Finish the transfer with `bytes` bytes on disk. */
  complete(bytes: number) {
    this.destination.write("x".repeat(bytes));
    this.settle(this.destination);
  }
}
