/**
 * Authenticates every room API request. The room address `K1` is an Ed25519 public key, and the
 * client signs `method ‖ path ‖ timestamp ‖ E_prev ‖ SHA-256(body)` with the matching seed (see
 * crypto.ts). Verifying here, as middleware, gates reads, list, and writes uniformly: knowing
 * `K1` alone (e.g. from leaked logs or an on-path proxy) is not enough to read, surveil metadata,
 * or write — only a holder of `S` can produce a valid signature.
 *
 * The timestamp must be within ±SIGNED_WINDOW_S of server time, which bounds replay of a captured
 * request to that window without any server-side state.
 */

import { verifyRequest } from '$lib/crypto';
import {
	EXPECTED_ETAG_HEADER,
	isValidK1,
	SIGNATURE_HEADER,
	SIGNED_WINDOW_S,
	TIMESTAMP_HEADER
} from '$lib/protocol';
import type { Handle } from '@sveltejs/kit';

const deny = (status: number) =>
	new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (pathname.startsWith('/api/room/')) {
		const k1 = pathname.split('/')[3] ?? '';
		const timestamp = event.request.headers.get(TIMESTAMP_HEADER);
		const signature = event.request.headers.get(SIGNATURE_HEADER);
		const ePrev = event.request.headers.get(EXPECTED_ETAG_HEADER) ?? '';

		if (!isValidK1(k1) || timestamp === null || signature === null) return deny(400);

		const ts = Number(timestamp);
		if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNED_WINDOW_S) {
			return deny(403);
		}

		// Hash a clone so the route handler can still read the original body.
		const body = new Uint8Array(await event.request.clone().arrayBuffer());
		const valid = await verifyRequest(
			k1,
			event.request.method,
			pathname,
			timestamp,
			ePrev,
			body,
			signature
		);
		if (!valid) return deny(403);
	}
	return resolve(event);
};
