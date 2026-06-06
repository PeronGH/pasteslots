/**
 * Slot envelope: content + metadata packed into a single MessagePack object, which is then
 * sealed with one AES-GCM operation (see crypto.ts). Because metadata travels inside the
 * encrypted envelope, the server stores nothing descriptive about a slot's plaintext.
 *
 * MessagePack (not JSON) so `content` stays raw bytes with no base64 inflation.
 */

import { decode, encode } from '@msgpack/msgpack';
import { asBytes, type Bytes } from './bytes';

/** The three clipboard types that round-trip across all major browsers. */
export type SlotMime = 'text/plain' | 'text/html' | 'image/png';

export interface SlotPlaintext {
	mime: SlotMime;
	/** Human-readable label (e.g. a text snippet or "PNG image"). */
	label: string;
	content: Bytes;
}

export function encodeSlot(slot: SlotPlaintext): Bytes {
	return asBytes(encode(slot));
}

export function decodeSlot(bytes: Uint8Array): SlotPlaintext {
	const obj = decode(bytes) as Record<string, unknown>;
	const { mime, label, content } = obj;
	if (
		(mime !== 'text/plain' && mime !== 'text/html' && mime !== 'image/png') ||
		typeof label !== 'string' ||
		!(content instanceof Uint8Array)
	) {
		throw new Error('malformed slot envelope');
	}
	return { mime, label, content: asBytes(content) };
}
