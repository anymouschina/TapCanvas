// Ambient 声明：tsconfig moduleResolution=Node（classic）不解析 lib0 / y-protocols 的
// "exports" 子路径；运行时通过动态 import()（ESM）解析。仅声明手写 WS sync handler 用到的导出。
declare module "lib0/encoding" {
  export type Encoder = unknown;
  export function createEncoder(): Encoder;
  export function writeVarUint(encoder: Encoder, num: number): void;
  export function writeVarUint8Array(encoder: Encoder, arr: Uint8Array): void;
  export function toUint8Array(encoder: Encoder): Uint8Array;
  export function length(encoder: Encoder): number;
}
declare module "lib0/decoding" {
  export type Decoder = unknown;
  export function createDecoder(arr: Uint8Array): Decoder;
  export function readVarUint(decoder: Decoder): number;
  export function readVarUint8Array(decoder: Decoder): Uint8Array;
}
declare module "y-protocols/sync" {
  import type { Doc } from "yjs";
  export function writeSyncStep1(encoder: unknown, doc: Doc): void;
  export function writeUpdate(encoder: unknown, update: Uint8Array): void;
  export function readSyncMessage(
    decoder: unknown,
    encoder: unknown,
    doc: Doc,
    transactionOrigin: unknown,
  ): number;
}
declare module "y-protocols/awareness" {
  import type { Doc } from "yjs";
  export class Awareness {
    constructor(doc: Doc);
    clientID: number;
    setLocalState(state: unknown): void;
    getStates(): Map<number, Record<string, unknown>>;
    on(event: "update", cb: (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void): void;
  }
  export function encodeAwarenessUpdate(awareness: Awareness, clients: number[]): Uint8Array;
  export function applyAwarenessUpdate(awareness: Awareness, update: Uint8Array, origin: unknown): void;
  export function removeAwarenessStates(awareness: Awareness, clients: number[], origin: unknown): void;
}
