import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		// Reinforces the "no third-party JavaScript" property the design rests on. SvelteKit adds a
		// per-request nonce to its own inline bootstrap, so `script-src 'self'` holds without breaking
		// hydration. `style-src`/`default-src` are intentionally left unset (Svelte/Vite inject inline
		// styles, and the only at-rest data is ciphertext); the script/frame/connect directives are
		// where the value is. `img-src` allows the blob: URLs used for decrypted image previews.
		csp: {
			mode: 'auto',
			directives: {
				'script-src': ['self'],
				'connect-src': ['self'],
				'img-src': ['self', 'blob:', 'data:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
