/**
 * End-to-end crypto for Paste Slots.
 *
 * From the URL-fragment secret `S` we derive three values via distinct, constant HKDF `info`
 * labels (domain separators, not secret salts — so derivation reproduces from `S` alone):
 *   sk = HKDF-SHA256(S, info="auth") — an Ed25519 SEED; signs requests; never leaves the browser
 *   K1 = Ed25519 public key = pub(sk) — the room address AND the server's write-verify key
 *   K2 = HKDF-SHA256(S, info="enc")  — the AES-256-GCM key, NON-EXTRACTABLE, never leaves the browser
 *
 * `K1` is public and reveals nothing about `sk`, `S`, or `K2`. Every request (read, list, and
 * write) carries an Ed25519 signature over a canonical `method ‖ path ‖ timestamp ‖ E_prev ‖
 * SHA-256(body)`, which the server verifies against `K1` (see hooks.server.ts). This makes `K1`
 * alone inert — an attacker who only learns the room address can neither write nor surveil
 * metadata — and the signed timestamp + E_prev close write rollback-replay. This single-hash
 * simplicity is only safe because `S` is a high-entropy CSPRNG UUID (see the page component).
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
	/** Ed25519 signing seed (private); signs requests, never leaves the browser. */
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
 * Canonical byte string an Ed25519 request signature covers, newline-joined so the
 * variable-length fields stay unambiguous:
 *
 *   method ‖ path ‖ timestamp ‖ E_prev ‖ base64url(SHA-256(body))
 *
 * Binding the method + path gates every endpoint (a read signature can't be reused for a
 * different slot or for a write); the timestamp gives freshness; E_prev keeps the CAS token
 * non-malleable on writes (empty string for reads); the body hash pins the payload.
 */
async function requestMessage(
	method: string,
	path: string,
	timestamp: string,
	ePrev: string,
	body: Bytes
): Promise<Bytes> {
	const bodyHash = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', body)));
	return utf8([method, path, timestamp, ePrev, bodyHash].join('\n'));
}

/** Sign a request with the room's Ed25519 seed. Returns a base64url detached signature. */
export async function signRequest(
	sk: Bytes,
	method: string,
	path: string,
	timestamp: string,
	ePrev: string,
	body: Bytes
): Promise<string> {
	return toBase64Url(
		await ed.signAsync(await requestMessage(method, path, timestamp, ePrev, body), sk)
	);
}

/** Verify a request signature against the room address `K1`. Returns false on any malformed input. */
export async function verifyRequest(
	k1: string,
	method: string,
	path: string,
	timestamp: string,
	ePrev: string,
	body: Bytes,
	sigB64: string
): Promise<boolean> {
	try {
		const msg = await requestMessage(method, path, timestamp, ePrev, body);
		return await ed.verifyAsync(fromBase64Url(sigB64), msg, fromBase64Url(k1));
	} catch {
		return false;
	}
}

const IV_BYTES = 12;

/**
 * Seal a plaintext: returns IV(12) ‖ AES-256-GCM(K2, plaintext). Fresh random IV per call.
 * `aad` (additional authenticated data) is covered by the tag but not encrypted — used to pin a
 * blob to its slot, so it cannot be moved to another slot without the tag failing.
 */
export async function seal(k2: CryptoKey, plaintext: Bytes, aad?: Bytes): Promise<Bytes> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k2, plaintext)
	);
	const body = new Uint8Array(IV_BYTES + ciphertext.length);
	body.set(iv, 0);
	body.set(ciphertext, IV_BYTES);
	return body;
}

/**
 * Open a sealed body (IV ‖ ciphertext). Throws if the GCM tag fails — i.e. any modified,
 * corrupted, forged, or wrong-slot (`aad` mismatch) blob is rejected rather than silently
 * accepted. `aad` must match the value passed to `seal`.
 */
export async function open(k2: CryptoKey, body: Bytes, aad?: Bytes): Promise<Bytes> {
	if (body.length <= IV_BYTES) throw new Error('sealed body too short');
	const iv = body.subarray(0, IV_BYTES);
	const ciphertext = body.subarray(IV_BYTES);
	return new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, k2, ciphertext)
	);
}
