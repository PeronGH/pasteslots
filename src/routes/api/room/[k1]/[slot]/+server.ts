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
	return { bucket, key: slotKey(params.k1, slot) };
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
 * Write a slot with optimistic compare-and-swap. The client sends its expected current etag
 * (a real etag, or the EMPTY sentinel for create-only). A single atomic conditional put — no
 * read-then-write TOCTOU. On conflict, return 412 + the fresh etag so the client resyncs in
 * one round trip.
 */
export const PUT: RequestHandler = async ({ params, platform, request }) => {
	const { bucket, key } = resolve(params, platform);
	const expected = request.headers.get(EXPECTED_ETAG_HEADER);
	const body = await request.arrayBuffer();

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

/** Clear a slot: delete the object, returning it to the absent/"empty" state. */
export const DELETE: RequestHandler = async ({ params, platform }) => {
	const { bucket, key } = resolve(params, platform);
	await bucket.delete(key);
	return new Response(null, { status: 204, headers: NO_STORE });
};
