/**
 * Client room state: polling sync + optimistic-CAS writes over the dumb blob-store API.
 *
 * Decrypted slot contents are kept in memory as they arrive so the Copy action can write the
 * clipboard synchronously (see clipboard.ts). All crypto happens here; the server only ever
 * sees the room address K1 and opaque ciphertext.
 */

import { browser } from '$app/environment';
import { type Bytes } from './bytes';
import { open, seal, type RoomKeys } from './crypto';
import { decodeSlot, encodeSlot, type SlotMime, type SlotPlaintext } from './envelope';
import { EMPTY, EXPECTED_ETAG_HEADER, SLOT_COUNT, type SlotListEntry } from './protocol';

export type SlotStatus = 'empty' | 'loading' | 'filled' | 'error';

export interface SlotView {
	status: SlotStatus;
	/** Current server etag, or the EMPTY sentinel when absent. */
	etag: string;
	mime?: SlotMime;
	label?: string;
	content?: Bytes;
	size?: number;
	uploaded?: string;
	/** Decoded text for text/plain and text/html (rendered as escaped text, never as HTML). */
	previewText?: string;
	/** Object URL for image/png previews. */
	imageUrl?: string;
	error?: string;
}

/** Thrown by `write` when the slot changed underneath us; the room has already resynced. */
export class SlotConflictError extends Error {
	constructor() {
		super('slot changed on the server — review the current content and try again');
		this.name = 'SlotConflictError';
	}
}

const ACTIVE_MS = 2500;
const IDLE_MS = 30_000;
/** Go idle after this long with no observed change. */
const BACKOFF_AFTER_MS = 60_000;

const decoder = new TextDecoder();

function emptySlot(): SlotView {
	return { status: 'empty', etag: EMPTY };
}

export class RoomState {
	readonly slots: SlotView[] = $state(Array.from({ length: SLOT_COUNT }, emptySlot));
	/** Non-null when the last poll failed to reach the server. */
	syncError = $state<string | null>(null);

	#keys: RoomKeys;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#lastChangeAt = 0;
	#stopped = true;

	constructor(keys: RoomKeys) {
		this.#keys = keys;
	}

	start() {
		if (!browser || !this.#stopped) return;
		this.#stopped = false;
		this.#lastChangeAt = Date.now();
		document.addEventListener('visibilitychange', this.#onVisibility);
		void this.#tick();
	}

	stop() {
		this.#stopped = true;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		if (browser) document.removeEventListener('visibilitychange', this.#onVisibility);
		for (const slot of this.slots) if (slot.imageUrl) URL.revokeObjectURL(slot.imageUrl);
	}

	#onVisibility = () => {
		if (!document.hidden) {
			this.#lastChangeAt = Date.now();
			this.#reschedule(0);
		}
	};

	#tick = async () => {
		if (this.#stopped) return;
		if (!document.hidden) await this.poll();
		this.#schedule();
	};

	#schedule() {
		if (this.#stopped) return;
		const idle = document.hidden || Date.now() - this.#lastChangeAt > BACKOFF_AFTER_MS;
		this.#timer = setTimeout(this.#tick, idle ? IDLE_MS : ACTIVE_MS);
	}

	#reschedule(delay: number) {
		if (this.#stopped) return;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(this.#tick, delay);
	}

	/** One sync pass: list the room, then GET + decrypt only the slots whose etag changed. */
	async poll() {
		let listing: SlotListEntry[];
		try {
			const res = await fetch(`/api/room/${this.#keys.k1}`);
			if (!res.ok) throw new Error(`list failed: ${res.status}`);
			listing = (await res.json()) as SlotListEntry[];
			this.syncError = null;
		} catch {
			this.syncError = 'cannot reach the server';
			return;
		}

		let changed = false;
		for (let n = 0; n < SLOT_COUNT; n++) {
			const entry = listing.find((e) => e.slot === n);
			const view = this.slots[n];
			if (!entry) {
				if (view.etag !== EMPTY) {
					this.#setEmpty(n);
					changed = true;
				}
				continue;
			}
			if (entry.etag !== view.etag) {
				changed = true;
				await this.#fetchSlot(n, entry);
			}
		}
		if (changed) this.#lastChangeAt = Date.now();
	}

	async #fetchSlot(n: number, entry: SlotListEntry) {
		this.slots[n].status = 'loading';
		try {
			const res = await fetch(`/api/room/${this.#keys.k1}/${n}`);
			if (res.status === 404) return this.#setEmpty(n);
			if (!res.ok) throw new Error(`get failed: ${res.status}`);
			const body = new Uint8Array(await res.arrayBuffer());
			const plain = decodeSlot(await open(this.#keys.k2, body));
			this.#applyPlain(n, entry.etag, plain, entry.size, entry.uploaded);
		} catch {
			// A blob that won't decrypt is a visible bad slot, never silently accepted.
			this.#setError(n, entry.etag);
		}
	}

	/** Write content to a slot with optimistic CAS. Throws SlotConflictError on a 412. */
	async write(n: number, plain: SlotPlaintext): Promise<void> {
		const expected = this.slots[n].etag;
		const body = await seal(this.#keys.k2, encodeSlot(plain));
		const res = await fetch(`/api/room/${this.#keys.k1}/${n}`, {
			method: 'PUT',
			headers: { [EXPECTED_ETAG_HEADER]: expected, 'content-type': 'application/octet-stream' },
			body
		});

		if (res.status === 412) {
			this.#reschedule(0);
			await this.poll();
			throw new SlotConflictError();
		}
		if (!res.ok) throw new Error(`write failed: ${res.status}`);

		const { etag } = (await res.json()) as { etag: string };
		// Transient display timestamp, immediately stringified; never stored as a reactive Date.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see comment above
		this.#applyPlain(n, etag, plain, body.length, new Date().toISOString());
		this.#lastChangeAt = Date.now();
	}

	/** Clear a slot: delete the object, returning it to the empty state. */
	async clear(n: number): Promise<void> {
		const res = await fetch(`/api/room/${this.#keys.k1}/${n}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`clear failed: ${res.status}`);
		this.#setEmpty(n);
		this.#lastChangeAt = Date.now();
	}

	#applyPlain(n: number, etag: string, plain: SlotPlaintext, size: number, uploaded: string) {
		const prev = this.slots[n];
		if (prev.imageUrl) URL.revokeObjectURL(prev.imageUrl);

		const next: SlotView = {
			status: 'filled',
			etag,
			mime: plain.mime,
			label: plain.label,
			content: plain.content,
			size,
			uploaded
		};
		if (plain.mime === 'image/png') {
			next.imageUrl = URL.createObjectURL(new Blob([plain.content], { type: 'image/png' }));
		} else {
			next.previewText = decoder.decode(plain.content);
		}
		this.slots[n] = next;
	}

	#setEmpty(n: number) {
		const prev = this.slots[n];
		if (prev.imageUrl) URL.revokeObjectURL(prev.imageUrl);
		this.slots[n] = emptySlot();
	}

	#setError(n: number, etag: string) {
		const prev = this.slots[n];
		if (prev.imageUrl) URL.revokeObjectURL(prev.imageUrl);
		this.slots[n] = { status: 'error', etag, error: 'cannot decrypt this slot' };
	}
}
