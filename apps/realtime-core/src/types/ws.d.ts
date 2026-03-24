declare module "ws" {
  import { EventEmitter } from "events";

  class WebSocket extends EventEmitter {
    constructor(url: string, options?: { headers?: Record<string, string> });
    send(data: string | Buffer): void;
    close(): void;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: WebSocket.Data) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
    off(event: "message", listener: (data: WebSocket.Data) => void): this;
    readyState: number;
  }

  namespace WebSocket {
    type Data = string | Buffer;
  }

  export = WebSocket;
}







