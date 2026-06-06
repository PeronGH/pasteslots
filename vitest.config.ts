import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic (crypto, envelope, CAS mapping) and run under Node's
// native WebCrypto — no SvelteKit/Vite plugin pipeline needed.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
