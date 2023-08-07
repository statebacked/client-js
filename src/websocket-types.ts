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
