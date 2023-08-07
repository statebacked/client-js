import { WebSocketCtorType, WebSocketType } from "./websocket-types.ts";

type OnDisconnect = () => void;
type OnConnect = () => OnDisconnect | undefined;

export class ReconnectingWebSocket<Incoming, Outgoing> {
  private ws?: WebSocketType;
  private listeners: Array<(msg: Incoming) => void> = [];
  private state: "idle" | "connecting" | "closed" = "closed";
  private msgQueue: Outgoing[] = [];
  private persistentMsgs: Outgoing[] = [];

  constructor(
    private readonly WS: WebSocketCtorType,
    private readonly url: string,
    private readonly onConnect: OnConnect,
  ) {}

  public send(msg: Outgoing) {
    if (this.ws?.readyState !== this.WS.OPEN) {
      this.msgQueue.push(msg);
      return;
    }

    this.ws.send(JSON.stringify(msg));
  }

  public persistentSend(msg: Outgoing) {
    this.persistentMsgs.push(msg);
    this.send(msg);
    const cancel = () => {
      this.persistentMsgs = this.persistentMsgs.filter((m) => m !== msg);
    };

    return cancel;
  }

  private connect() {
    if (this.state === "connecting" || this.state === "closed") {
      return;
    }

    // TODO: check tab visibility and delay if hidden

    let onDisconnect: OnDisconnect | undefined;
    this.state = "connecting";
    const ws = new this.WS(this.url);

    ws.onopen = () => {
      this.state = "idle";
      this.ws = ws;
      for (const msg of this.persistentMsgs.concat(this.msgQueue)) {
        this.ws.send(JSON.stringify(msg));
      }
      this.msgQueue.splice(0, this.msgQueue.length);
      onDisconnect = this.onConnect();
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Incoming;
        for (const listener of this.listeners) {
          listener(msg);
        }
      } catch (_) {
        // swallow
      }
    };
    ws.onclose = () => {
      this.ws = undefined;
      onDisconnect?.();
      this.connect();
    };
  }

  public addListener(listener: (msg: Incoming) => void) {
    if (this.state === "closed") {
      this.state = "idle";
      this.connect();
    }
    this.listeners.push(listener);
  }

  public removeListener(listener: (msg: Incoming) => void) {
    this.listeners = this.listeners.filter((l) => l !== listener);
    if (this.listeners.length === 0) {
      this.close();
    }
  }

  public close() {
    this.state = "closed";
    this.ws?.close();
    this.ws = undefined;
  }
}
