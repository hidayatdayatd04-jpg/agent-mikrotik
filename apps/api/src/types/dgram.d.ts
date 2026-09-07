/**
 * Bun resolves `node:dgram` types via @types/node 26, where `Socket` is
 * declared with `implements EventEmitter` but the class body itself omits the
 * event-emitter members (hidden by skipLibCheck). The runtime socket DOES
 * support `.on()` — this augmentation restores the typed surface.
 */
declare module "node:dgram" {
  interface Socket {
    on(event: "error", listener: (err: Error) => void): this;
    on(
      event: "message",
      listener: (msg: Buffer, rinfo: { address: string; family: string; port: number; size: number }) => void,
    ): this;
    on(event: "listening", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "connect", listener: () => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "message", listener: (msg: Buffer, rinfo: { address: string }) => void): this;
  }
}
