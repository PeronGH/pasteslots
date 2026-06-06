<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const REPO_URL = 'https://github.com/PeronGH/pasteslots';
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col bg-gray-50 text-gray-900">
	<div class="flex-1">
		{@render children()}
	</div>
	<footer class="space-y-1 border-t border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
		<p class="text-sm font-semibold text-gray-600">Paste Slots</p>
		<p>An end-to-end encrypted pasteboard. Open this same link on another device to sync.</p>
		<a href={REPO_URL} rel="external" class="inline-block hover:text-gray-600 hover:underline"
			>Open source</a
		>
	</footer>
</div>
