import { describe, expect, it } from 'vitest';
import { asBytes } from './bytes';
import {
	decodeSlot,
	encodeSlot,
	makeTombstone,
	TOMBSTONE_MIME,
	type SlotPlaintext
} from './envelope';

const utf8 = (s: string) => asBytes(new TextEncoder().encode(s));

describe('encodeSlot / decodeSlot', () => {
	it('round-trips text/plain', () => {
		const slot: SlotPlaintext = { mime: 'text/plain', content: utf8('hello world') };
		expect(decodeSlot(encodeSlot(slot))).toEqual(slot);
	});

	it('round-trips text/html', () => {
		const slot: SlotPlaintext = { mime: 'text/html', content: utf8('<b>bold</b>') };
		expect(decodeSlot(encodeSlot(slot))).toEqual(slot);
	});

	it('round-trips image/png raw bytes without base64 inflation', () => {
		// A 4 KiB PNG-shaped blob (signature + random bytes). At this size base64 would
		// inflate by ~33%; msgpack stores `content` as raw bin, so overhead is a tiny header.
		const content = crypto.getRandomValues(new Uint8Array(4096));
		content.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
		const slot: SlotPlaintext = { mime: 'image/png', content };
		const encoded = encodeSlot(slot);
		expect(encoded.length).toBeLessThan(content.length + 64); // not content.length * 1.33
		const decoded = decodeSlot(encoded);
		expect(decoded.content).toEqual(content);
		expect(decoded.content).toBeInstanceOf(Uint8Array);
	});

	it('rejects an unknown mime type', () => {
		const bad = encodeSlot({
			mime: 'application/zip' as SlotPlaintext['mime'],
			content: new Uint8Array(1)
		});
		expect(() => decodeSlot(bad)).toThrow();
	});

	it('round-trips a tombstone and tags it as such', () => {
		const tombstone = makeTombstone();
		const decoded = decodeSlot(encodeSlot(tombstone));
		expect(decoded.mime).toBe(TOMBSTONE_MIME);
		expect(decoded).toEqual(tombstone);
	});

	it('gives each tombstone a distinct UUID payload', () => {
		expect(makeTombstone().content).not.toEqual(makeTombstone().content);
	});
});
