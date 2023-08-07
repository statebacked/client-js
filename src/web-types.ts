/**
 * WebSocket class type.
 */
export interface WebSocketCtorType {
  new (url: string, protocols?: string | string[] | undefined): WebSocketType;

  readonly CLOSED: number;
  readonly CLOSING: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
}

/**
 * WebSocket instance type.
 */
export interface WebSocketType {
  readyState: number;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;

  onclose:
    | ((ev: Event & { code: number; reason: string; wasClean: boolean }) => any)
    | null;
  onerror: ((ev: Event) => any) | null;
  onmessage:
    | ((
      ev: Event & { data: string; lastEventId: string; ports: Array<any> },
    ) => any)
    | null;
  onopen: ((ev: Event) => any) | null;
}

/**
 * fetch
 */
export interface Fetch {
  (
    input: URL | string,
    init?: RequestInit,
  ): Promise<Response>;
}

interface RequestInit {
  readonly headers?: Record<string, string>;
  readonly body?: string | Blob | FormData | null;
  readonly method?: string;
  readonly signal?: AbortSignal;
}

/**
 * fetch Response
 */
export interface Response {
  readonly ok: boolean;
  readonly status: number;

  json(): Promise<unknown>;
}

/**
 * Blob constructor
 */
export interface BlobCtorType {
  new (
    blobParts?: Array<Uint8Array | string>,
    options?: { type?: string },
  ): Blob;
}

/**
 * Blob
 */
interface Blob {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): Blob;
  text(): Promise<string>;
}

/**
 * FormData constructor
 */
export interface FormDataCtorType {
  new (): FormData;
}

type FormDataEntryValue = string | Blob;

/**
 * FormData
 */
interface FormData {
  append(name: string, value: string | Blob, fileName?: string): void;
  delete(name: string): void;
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  set(name: string, value: string | Blob, fileName?: string): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
  forEach(
    callback: (value: FormDataEntryValue, key: string, parent: this) => void,
    thisArg?: any,
  ): void;
}
