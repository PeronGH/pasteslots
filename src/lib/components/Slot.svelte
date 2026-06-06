<script lang="ts">
	import { readClipboard, readPasteEvent, writeClipboard } from '$lib/clipboard';
	import { RoomState, SlotConflictError } from '$lib/room.svelte';

	let { room, index }: { room: RoomState; index: number } = $props();

	const slot = $derived(room.slots[index]);

	let busy = $state(false);
	let copied = $state(false);
	let message = $state<string | null>(null);
	let showManual = $state(false);

	const mimeLabel: Record<string, string> = {
		'text/plain': 'Text',
		'text/html': 'HTML',
		'image/png': 'PNG'
	};

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function paste() {
		busy = true;
		message = null;
		try {
			const plain = await readClipboard(); // FIRST — preserve the user gesture
			await room.write(index, plain); // then encrypt + upload
			showManual = false;
		} catch (error) {
			if (error instanceof SlotConflictError) message = error.message;
			else {
				message = 'Could not read the clipboard — use manual paste below.';
				showManual = true;
			}
		} finally {
			busy = false;
		}
	}

	function copy() {
		// Synchronous: content is already decrypted in memory, so no await before writing.
		if (slot.status !== 'filled' || !slot.content || !slot.mime) return;
		message = null;
		writeClipboard({ mime: slot.mime, content: slot.content })
			.then(() => {
				copied = true;
				setTimeout(() => (copied = false), 1200);
			})
			.catch(() => (message = 'Copy failed.'));
	}

	async function clear() {
		busy = true;
		message = null;
		try {
			await room.clear(index);
			showManual = false;
		} catch {
			message = 'Clear failed.';
		} finally {
			busy = false;
		}
	}

	async function onManualPaste(event: ClipboardEvent) {
		event.preventDefault();
		busy = true;
		message = null;
		try {
			const plain = await readPasteEvent(event);
			await room.write(index, plain);
			showManual = false;
		} catch (error) {
			message =
				error instanceof SlotConflictError ? error.message : 'Could not read pasted content.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between gap-2">
		<h2 class="truncate text-sm font-semibold text-gray-700">Slot {index + 1}</h2>
		{#if slot.status === 'filled' && slot.mime}
			<span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
				{mimeLabel[slot.mime]}
			</span>
		{/if}
	</header>

	<div
		class="flex min-h-28 items-center justify-center overflow-hidden rounded-lg bg-gray-50 p-2 text-sm"
	>
		{#if slot.status === 'empty'}
			<span class="text-gray-400">Empty</span>
		{:else if slot.status === 'loading'}
			<span class="text-gray-400">Loading…</span>
		{:else if slot.status === 'error'}
			<span class="text-red-600">{slot.error}</span>
		{:else if slot.mime === 'image/png' && slot.imageUrl}
			<img src={slot.imageUrl} alt="Slot {index + 1}" class="max-h-40 max-w-full object-contain" />
		{:else}
			<!-- User content is shown as escaped text, never rendered as HTML, to avoid XSS. -->
			<pre
				class="max-h-40 w-full overflow-auto text-xs whitespace-pre-wrap text-gray-700">{slot.previewText}</pre>
		{/if}
	</div>

	{#if slot.status === 'filled' && slot.size !== undefined}
		<p class="text-xs text-gray-400">{formatSize(slot.size)}</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={paste}
			disabled={busy}
			class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
		>
			Paste
		</button>
		{#if slot.status === 'filled'}
			<button
				type="button"
				onclick={copy}
				class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		{/if}
		{#if slot.status === 'filled' || slot.status === 'error'}
			<button
				type="button"
				onclick={clear}
				disabled={busy}
				class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
			>
				Clear
			</button>
		{/if}
	</div>

	{#if message}
		<p class="text-xs text-amber-700">{message}</p>
	{/if}

	{#if showManual}
		<input
			type="text"
			onpaste={onManualPaste}
			placeholder="Click here, then press ⌘V / Ctrl+V"
			class="w-full rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs"
		/>
	{/if}
</div>
