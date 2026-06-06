/**
 * Wire protocol shared by the client and the server endpoints.
 *
 * The server is a dumb conditional blob store: it validates the shape of the room
 * address and slot index, maps the client's expected-etag into an R2 conditional put,
 * and otherwise just proxies bytes. None of this touches the secret or the key.
 *
 * `R2Conditional` is a global ambient type from the generated worker-configuration.d.ts.
 */

/** A room is exactly four fixed slots. */
export const SLOT_COUNT = 4;

/**
 * Sentinel an empty slot reports as its "current etag". Safe because real R2 etags are
 * MD5 hex digests and can never equal this. The server translates it into put-if-absent;
 * the literal string is never passed to `etagMatches`.
 */
export const EMPTY = 'empty';

/**
 * Header carrying the expected current etag (real etag or the EMPTY sentinel) on a write.
 * Custom name (not standard `If-Match`) so no proxy/edge layer interprets it.
 */
export const EXPECTED_ETAG_HEADER = 'x-expected-etag';

/** Header carrying the base64url Ed25519 signature over `slot ‖ E_prev ‖ SHA-256(body)`. */
export const SIGNATURE_HEADER = 'x-write-sig';

/** K1 is base64url of an Ed25519 public key (32 bytes) ⇒ 43 chars, no padding. */
export function isValidK1(k1: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(k1);
}

/** Parse a slot path segment into 0..SLOT_COUNT-1, or null if out of range/malformed. */
export function parseSlot(raw: string): number | null {
	if (!/^\d+$/.test(raw)) return null;
	const n = Number(raw);
	return n >= 0 && n < SLOT_COUNT ? n : null;
}

export function slotKey(k1: string, slot: number): string {
	return `${k1}/${slot}`;
}

/**
 * Map the client's expected etag into an R2 conditional put (optimistic CAS):
 *  - EMPTY / missing → create-only (`etagDoesNotMatch: '*'`): a stale "thought it was empty"
 *    write fails instead of clobbering live data.
 *  - a real etag → `etagMatches`: a stale "held an old etag" write fails and forces a resync.
 */
export function putConditionFor(ifMatch: string | null): R2Conditional {
	if (ifMatch === null || ifMatch === EMPTY) return { etagDoesNotMatch: '*' };
	return { etagMatches: ifMatch };
}

/** One slot's state as reported by the room listing. */
export interface SlotListEntry {
	slot: number;
	etag: string;
	size: number;
	uploaded: string; // ISO timestamp
}
