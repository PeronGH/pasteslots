/**
 * End-to-end crypto for Paste Slots.
 *
 * From the URL-fragment secret `S` we derive three values via distinct, constant HKDF `info`
 * labels (domain separators, not secret salts — so derivation reproduces from `S` alone):
 *   sk = HKDF-SHA256(S, info="auth") — an Ed25519 SEED; signs writes; never leaves the browser
 *   K1 = Ed25519 public key = pub(sk) — the room address AND the server's write-verify key
 *   K2 = HKDF-SHA256(S, info="enc")  — the AES-256-GCM key, NON-EXTRACTABLE, never leaves the browser
 *
 * `K1` is public and reveals nothing about `sk`, `S`, or `K2`. Each write carries an Ed25519
 * signature over `slot ‖ E_prev ‖ SHA-256(body)`, which the honest server verifies against `K1`
 * before its conditional put — closing the rollback-replay gap (the CAS etag is no longer a
 * cleartext, attacker-malleable token). This single-hash simplicity is only safe because `S` is a
 * high-entropy CSPRNG UUID (see the UUID generation in the page component).
 */

import * as ed from '@noble/ed25519';
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
	/** Room address = Ed25519 public key pub(sk). Public; safe to send to the server. */
	k1: string;
	/** AES-256-GCM content key: non-extractable, stays in the browser. */
	k2: CryptoKey;
	/** Ed25519 signing seed (private); signs writes, never leaves the browser. */
	sk: Bytes;
}

/** Derive the signing seed, room address, and content key from the fragment secret `S`. */
export async function deriveKeys(secret: string): Promise<RoomKeys> {
	const material = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, [
		'deriveBits',
		'deriveKey'
	]);
	const salt = new Uint8Array(0); // constant (empty) — derivation must reproduce from S alone

	const skBits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('auth') },
		material,
		256
	);
	const sk = asBytes(new Uint8Array(skBits));

	const k2 = await crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('enc') },
		material,
		{ name: 'AES-GCM', length: 256 },
		false, // non-extractable
		['encrypt', 'decrypt']
	);

	return { k1: toBase64Url(await ed.getPublicKeyAsync(sk)), k2, sk };
}

/**
 * The byte string an Ed25519 write signature covers: `slot(1) ‖ E_prev(utf8) ‖ SHA-256(body)`.
 * The fixed-length slot (front) and hash (back) make the variable-length `E_prev` unambiguous.
 */
async function writeMessage(slot: number, ePrev: string, body: Bytes): Promise<Bytes> {
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
	const ep = utf8(ePrev);
	const msg = new Uint8Array(1 + ep.length + hash.length);
	msg[0] = slot;
	msg.set(ep, 1);
	msg.set(hash, 1 + ep.length);
	return asBytes(msg);
}

/** Sign a write with the room's Ed25519 seed. Returns a base64url detached signature. */
export async function signWrite(
	sk: Bytes,
	slot: number,
	ePrev: string,
	body: Bytes
): Promise<string> {
	return toBase64Url(await ed.signAsync(await writeMessage(slot, ePrev, body), sk));
}

/** Verify a write signature against the room address `K1`. Returns false on any malformed input. */
export async function verifyWrite(
	k1: string,
	slot: number,
	ePrev: string,
	body: Bytes,
	sigB64: string
): Promise<boolean> {
	try {
		const msg = await writeMessage(slot, ePrev, body);
		return await ed.verifyAsync(fromBase64Url(sigB64), msg, fromBase64Url(k1));
	} catch {
		return false;
	}
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
