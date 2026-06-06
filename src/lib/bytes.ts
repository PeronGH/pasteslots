/**
 * Binary payloads in this app are always ArrayBuffer-backed at runtime. TypeScript's lib types
 * model `Uint8Array` as generic over `ArrayBufferLike` (which also covers `SharedArrayBuffer`),
 * and WebCrypto, `Blob`, and `fetch` reject that wider type. `Bytes` pins the ArrayBuffer-backed
 * form; `asBytes` narrows the over-wide return types from `TextEncoder` and MessagePack — safe
 * because neither ever produces a SharedArrayBuffer-backed view.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export function asBytes(view: Uint8Array): Bytes {
	return view as Bytes;
}
