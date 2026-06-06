# CLAUDE.md

SvelteKit app deployed on **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`, config in `wrangler.jsonc`).

## Package manager

Use **bun** for all dependency and script commands (`bun install`, `bun run <script>`).

## Before committing

Run format, lint, and check, and ensure all pass:

```sh
bun run format   # prettier --write
bun run lint     # prettier --check + eslint
bun run check    # svelte-kit sync + svelte-check (type/Svelte diagnostics)
```

## Deploy

`bun run deploy` builds and runs `wrangler deploy`.
