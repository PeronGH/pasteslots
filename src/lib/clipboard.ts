/**
 * Clipboard integration. Both directions must respect the user-activation rules that Safari
 * enforces:
 *  - Paste: call `navigator.clipboard.read()` as the FIRST thing in the handler, before any
 *    crypto or network, or the activation is lost.
 *  - Copy: call `navigator.clipboard.write*` synchronously from already-in-memory content,
 *    with no `await` before it.
 */

import { asBytes } from './bytes';
import type { SlotMime, SlotPlaintext } from './envelope';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Preference order for what to capture when the clipboard offers multiple types. */
const PREFERRED: SlotMime[] = ['image/png', 'text/html', 'text/plain'];

/**
 * Read the clipboard via the async Clipboard API. MUST be the first call in a click handler.
 * Returns the highest-priority supported type found.
 */
export async function readClipboard(): Promise<SlotPlaintext> {
	const items = await navigator.clipboard.read();
	for (const mime of PREFERRED) {
		for (const item of items) {
			if (item.types.includes(mime)) {
				const content = new Uint8Array(await (await item.getType(mime)).arrayBuffer());
				return { mime, content };
			}
		}
	}
	throw new Error('clipboard has no supported content (text or PNG image)');
}

/**
 * Manual fallback: extract supported content from a native `paste` ClipboardEvent, for
 * contexts where programmatic `clipboard.read()` is blocked.
 */
export async function readPasteEvent(event: ClipboardEvent): Promise<SlotPlaintext> {
	const data = event.clipboardData;
	if (!data) throw new Error('paste event carried no clipboard data');

	for (const item of data.items) {
		if (item.type === 'image/png') {
			const file = item.getAsFile();
			if (file) {
				const content = new Uint8Array(await file.arrayBuffer());
				return { mime: 'image/png', content };
			}
		}
	}
	const html = data.getData('text/html');
	if (html) {
		return { mime: 'text/html', content: asBytes(encoder.encode(html)) };
	}
	const text = data.getData('text/plain');
	if (text) {
		return { mime: 'text/plain', content: asBytes(encoder.encode(text)) };
	}
	throw new Error('paste event has no supported content');
}

/**
 * Write a slot's content back to the clipboard. Call SYNCHRONOUSLY from the click handler:
 * `content` is already decrypted in memory, so nothing needs to be awaited beforehand.
 */
export function writeClipboard(slot: SlotPlaintext): Promise<void> {
	if (slot.mime === 'text/plain') {
		return navigator.clipboard.writeText(decoder.decode(slot.content));
	}
	const blob = new Blob([slot.content], { type: slot.mime });
	return navigator.clipboard.write([new ClipboardItem({ [slot.mime]: blob })]);
}
