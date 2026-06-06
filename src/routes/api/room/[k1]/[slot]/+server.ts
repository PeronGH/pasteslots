import { error, json } from '@sveltejs/kit';
import {
	EXPECTED_ETAG_HEADER,
	isValidK1,
	parseSlot,
	putConditionFor,
	slotKey
} from '$lib/protocol';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/** Validate the path and grab the R2 binding, or throw the appropriate client/server error. */
function resolve(params: { k1: string; slot: string }, platform: App.Platform | undefined) {
	if (!isValidK1(params.k1)) error(400, 'bad room address');
	const slot = parseSlot(params.slot);
	if (slot === null) error(400, 'bad slot');
	const bucket = platform?.env.BUCKET;
	if (!bucket) error(503, 'storage unavailable');
	return { bucket, slot, key: slotKey(params.k1, slot) };
}

/**
 * Read a slot's sealed body. Supports a conditional GET via `If-None-Match`: when the etag
 * is unchanged R2 returns metadata only, which we turn into a 304 (no egress).
 */
export const GET: RequestHandler = async ({ params, platform, request }) => {
	const { bucket, key } = resolve(params, platform);
	const ifNoneMatch = request.headers.get('if-none-match');

	const object = await bucket.get(
		key,
		ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined
	);
	if (!object) return new Response(null, { status: 404, headers: NO_STORE });
	if (!('body' in object) || !object.body) {
		return new Response(null, { status: 304, headers: { ...NO_STORE, etag: object.etag } });
	}
	return new Response(object.body, {
		headers: { ...NO_STORE, 'content-type': 'application/octet-stream', etag: object.etag }
	});
};

/**
 * Write a slot with optimistic compare-and-swap. The request's Ed25519 signature (covering the
 * expected etag, timestamp, and body) is already verified by the middleware in hooks.server.ts,
 * so by here the signed `E_prev` is trustworthy — a capture-capable attacker can't forge a write
 * or roll the slot back by swapping the etag. A single atomic conditional put follows; on
 * conflict, return 412 + the fresh etag so the client resyncs in one round trip.
 */
export const PUT: RequestHandler = async ({ params, platform, request }) => {
	const { bucket, key } = resolve(params, platform);
	const expected = request.headers.get(EXPECTED_ETAG_HEADER);
	const body = new Uint8Array(await request.arrayBuffer());

	const result = await bucket.put(key, body, {
		onlyIf: putConditionFor(expected),
		httpMetadata: { contentType: 'application/octet-stream' }
	});

	if (!result) {
		const head = await bucket.head(key); // fresh etag, no egress
		return json({ etag: head?.etag ?? null }, { status: 412, headers: NO_STORE });
	}
	return json({ etag: result.etag }, { headers: NO_STORE });
};

// There is no DELETE: clearing is a conditional-CAS PUT of an encrypted tombstone (see the
// client's clear()). R2's delete has no compare-and-swap, so a raw delete could clobber a
// concurrent write — the tombstone keeps clearing on the same no-lost-update path as writes.
