/**
 * Slot envelope: the content and its MIME type packed into a single MessagePack object, which is
 * then sealed with one AES-GCM operation (see crypto.ts). Because the MIME type travels inside
 * the encrypted envelope, the server stores nothing descriptive about a slot's plaintext.
 *
 * MessagePack (not JSON) so `content` stays raw bytes with no base64 inflation.
 *
 * A cleared slot is a *tombstone*: an encrypted, present object (not a deleted one). This lets
 * clearing use the same conditional-CAS PUT as a write — R2's delete has no compare-and-swap, so
 * a tombstone is the only way to clear without risking a lost update. The client renders it as
 * empty.
 */

import { decode, encode } from '@msgpack/msgpack';
import { asBytes, type Bytes } from './bytes';

/** The three clipboard types that round-trip across all major browsers. */
export type SlotMime = 'text/plain' | 'text/html' | 'image/png';

/** Internal content type marking a tombstone; lives inside the encrypted envelope. */
export const TOMBSTONE_MIME = 'application/vnd.pasteslots.tombstone';

export interface SlotPlaintext {
	mime: SlotMime;
	content: Bytes;
}

export interface Tombstone {
	mime: typeof TOMBSTONE_MIME;
	/** A fresh UUID so each tombstone is a distinct value. */
	content: Bytes;
}

export type SlotEnvelope = SlotPlaintext | Tombstone;

const encoder = new TextEncoder();

export function makeTombstone(): Tombstone {
	return { mime: TOMBSTONE_MIME, content: asBytes(encoder.encode(crypto.randomUUID())) };
}

export function encodeSlot(envelope: SlotEnvelope): Bytes {
	return asBytes(encode(envelope));
}

export function decodeSlot(bytes: Bytes): SlotEnvelope {
	const obj = decode(bytes) as Record<string, unknown>;
	const { mime, content } = obj;
	if (!(content instanceof Uint8Array)) throw new Error('malformed slot envelope');

	if (mime === TOMBSTONE_MIME) {
		return { mime, content: asBytes(content) };
	}

	if (mime !== 'text/plain' && mime !== 'text/html' && mime !== 'image/png') {
		throw new Error('malformed slot envelope');
	}
	return { mime, content: asBytes(content) };
}
