import { describe, expect, it } from 'vitest';
import { deriveKeys, fromBase64Url, open, seal, toBase64Url } from './crypto';

const S = '11111111-2222-3333-4444-555555555555';

describe('base64url', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});

	it('is URL/R2-key safe (no +, /, or =)', () => {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('deriveKeys', () => {
	it('is deterministic for the same secret', async () => {
		const a = await deriveKeys(S);
		const b = await deriveKeys(S);
		expect(a.k1).toBe(b.k1);
		expect(a.k1).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits, base64url no padding
	});

	it('yields different room addresses for different secrets', async () => {
		const a = await deriveKeys(S);
		const b = await deriveKeys('99999999-2222-3333-4444-555555555555');
		expect(a.k1).not.toBe(b.k1);
	});

	it('derives a non-extractable AES key', async () => {
		const { k2 } = await deriveKeys(S);
		expect(k2.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', k2)).rejects.toThrow();
	});

	it('K1 and K2 are independent — K1 bytes are not the K2 key', async () => {
		// Decrypting with a key imported from K1 bytes must fail, proving the domain
		// separation actually produced distinct key material.
		const { k1, k2 } = await deriveKeys(S);
		const body = await seal(k2, new Uint8Array([1, 2, 3]));
		const fakeKey = await crypto.subtle.importKey(
			'raw',
			fromBase64Url(k1),
			{ name: 'AES-GCM' },
			false,
			['decrypt']
		);
		const iv = body.subarray(0, 12);
		await expect(
			crypto.subtle.decrypt({ name: 'AES-GCM', iv }, fakeKey, body.subarray(12))
		).rejects.toThrow();
	});
});

describe('seal / open', () => {
	it('round-trips plaintext', async () => {
		const { k2 } = await deriveKeys(S);
		const plaintext = crypto.getRandomValues(new Uint8Array(1024));
		const opened = await open(k2, await seal(k2, plaintext));
		expect(opened).toEqual(plaintext);
	});

	it('uses a fresh IV per seal (ciphertexts differ for identical input)', async () => {
		const { k2 } = await deriveKeys(S);
		const plaintext = new Uint8Array([42, 42, 42]);
		const a = await seal(k2, plaintext);
		const b = await seal(k2, plaintext);
		expect(a).not.toEqual(b); // distinct IVs ⇒ distinct bodies ⇒ unique etags
	});

	it('rejects a tampered body (GCM tag failure)', async () => {
		const { k2 } = await deriveKeys(S);
		const body = await seal(k2, new Uint8Array([1, 2, 3, 4]));
		body[body.length - 1] ^= 0xff; // flip a ciphertext bit
		await expect(open(k2, body)).rejects.toThrow();
	});

	it('rejects decryption under the wrong key', async () => {
		const a = await deriveKeys(S);
		const b = await deriveKeys('00000000-0000-0000-0000-000000000000');
		const body = await seal(a.k2, new Uint8Array([9, 8, 7]));
		await expect(open(b.k2, body)).rejects.toThrow();
	});
});
