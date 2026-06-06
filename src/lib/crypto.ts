/**
 * End-to-end crypto for Paste Slots.
 *
 * From the URL-fragment secret `S` we derive two cryptographically independent values:
 *   K1 = HKDF-SHA256(S, info="k1")  — the room address, sent to the server (one-way, reveals nothing about S/K2)
 *   K2 = HKDF-SHA256(S, info="enc") — the AES-256-GCM key, NON-EXTRACTABLE, never leaves the browser
 *
 * The `info` labels are constant domain separators (not secret salts), so derivation reproduces
 * from `S` alone on any device. This single-hash simplicity is only safe because `S` is a
 * high-entropy CSPRNG UUID (see the UUID generation in the page component).
 */

import { asBytes, type Bytes } from './bytes';

const encoder = new TextEncoder();

function utf8(s: string): Bytes {
	return asBytes(encoder.encode(s));
}

/** RFC 4648 §5 base64url, no padding. URL-safe and R2-key-safe. */
export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Bytes {
	const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export interface RoomKeys {
	/** Room address: a one-way function of S, safe to send to the server. */
	k1: string;
	/** AES-256-GCM content key: non-extractable, stays in the browser. */
	k2: CryptoKey;
}

/** Derive the room address and content key from the fragment secret `S`. */
export async function deriveKeys(secret: string): Promise<RoomKeys> {
	const material = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, [
		'deriveBits',
		'deriveKey'
	]);
	const salt = new Uint8Array(0); // constant (empty) — derivation must reproduce from S alone

	const k1Bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('k1') },
		material,
		256
	);

	const k2 = await crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('enc') },
		material,
		{ name: 'AES-GCM', length: 256 },
		false, // non-extractable
		['encrypt', 'decrypt']
	);

	return { k1: toBase64Url(new Uint8Array(k1Bits)), k2 };
}

const IV_BYTES = 12;

/** Seal a plaintext: returns IV(12) ‖ AES-256-GCM(K2, plaintext). Fresh random IV per call. */
export async function seal(k2: CryptoKey, plaintext: Bytes): Promise<Bytes> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, plaintext)
	);
	const body = new Uint8Array(IV_BYTES + ciphertext.length);
	body.set(iv, 0);
	body.set(ciphertext, IV_BYTES);
	return body;
}

/**
 * Open a sealed body (IV ‖ ciphertext). Throws if the GCM tag fails — i.e. any modified,
 * corrupted, or forged blob is rejected rather than silently accepted.
 */
export async function open(k2: CryptoKey, body: Bytes): Promise<Bytes> {
	if (body.length <= IV_BYTES) throw new Error('sealed body too short');
	const iv = body.subarray(0, IV_BYTES);
	const ciphertext = body.subarray(IV_BYTES);
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ciphertext));
}
