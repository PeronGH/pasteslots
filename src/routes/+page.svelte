<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { deriveKeys } from '$lib/crypto';
	import { RoomState } from '$lib/room.svelte';
	import Slot from '$lib/components/Slot.svelte';
	import { SLOT_COUNT } from '$lib/protocol';

	let room = $state<RoomState | null>(null);
	let initError = $state<string | null>(null);
	let linkCopied = $state(false);

	onMount(async () => {
		try {
			let secret = location.hash.slice(1);
			if (!secret) {
				// THE single most security-critical line: S must come from a CSPRNG.
				// crypto.randomUUID() is 122 bits of CSPRNG entropy; every guarantee rests on this.
				secret = crypto.randomUUID();
				history.replaceState(null, '', `#${secret}`);
			}
			const keys = await deriveKeys(secret);
			const state = new RoomState(keys);
			state.start();
			room = state;
		} catch {
			initError = 'Could not initialize this room. A secure context (HTTPS) is required.';
		}
	});

	onDestroy(() => room?.stop());

	async function copyLink() {
		await navigator.clipboard.writeText(location.href);
		linkCopied = true;
		setTimeout(() => (linkCopied = false), 1500);
	}
</script>

<svelte:head>
	<title>Paste Slots</title>
	<meta name="description" content="An end-to-end encrypted cross-device pasteboard." />
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8">
	<header class="mb-6">
		<h1 class="text-2xl font-bold text-gray-900">Paste Slots</h1>
		<p class="mt-1 text-sm text-gray-500">
			An end-to-end encrypted pasteboard. Open this same link on another device to sync.
		</p>
	</header>

	{#if initError}
		<p class="rounded-lg bg-red-50 p-4 text-sm text-red-700">{initError}</p>
	{:else if room}
		{#if room.syncError}
			<p class="mb-4 text-xs text-amber-700">⚠ {room.syncError} — retrying…</p>
		{/if}

		<div class="grid grid-cols-2 gap-4">
			{#each { length: SLOT_COUNT }, index (index)}
				<Slot {room} {index} />
			{/each}
		</div>

		<div class="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
			<button
				type="button"
				onclick={copyLink}
				class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
			>
				{linkCopied ? 'Link copied!' : 'Copy room link'}
			</button>
			<p class="text-xs text-amber-800">
				Anyone with this link has full read &amp; write access. The secret lives only in the URL
				fragment and is never sent to the server.
			</p>
		</div>
	{:else}
		<p class="text-sm text-gray-400">Initializing…</p>
	{/if}
</main>
