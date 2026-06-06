import { error, json } from '@sveltejs/kit';
import { isValidK1, parseSlot, type SlotListEntry } from '$lib/protocol';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * List a room: one R2 `list` returns each slot's etag, size, and upload time in a single
 * Class A op (no cursor needed at four keys). Metadata is encrypted in the body, so no
 * `include` is required. The client diffs these etags to decide which slots to fetch.
 */
export const GET: RequestHandler = async ({ params, platform }) => {
	const { k1 } = params;
	if (!isValidK1(k1)) error(400, 'bad room address');

	const bucket = platform?.env.BUCKET;
	if (!bucket) error(503, 'storage unavailable');

	const listing = await bucket.list({ prefix: `${k1}/` });
	const slots: SlotListEntry[] = [];
	for (const obj of listing.objects) {
		const slot = parseSlot(obj.key.slice(k1.length + 1));
		if (slot !== null) {
			slots.push({
				slot,
				etag: obj.etag,
				size: obj.size,
				uploaded: obj.uploaded.toISOString()
			});
		}
	}
	return json(slots, { headers: NO_STORE });
};
