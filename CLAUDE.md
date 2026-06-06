# CLAUDE.md

SvelteKit app deployed on **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`, config in `wrangler.jsonc`).

End-to-end encrypted 4-slot pasteboard; see `README.md` for the design. Key modules:

- `src/lib/crypto.ts` — HKDF key derivation (`K1` room address, `K2` content key) + AES-GCM seal/open.
- `src/lib/envelope.ts` — MessagePack slot envelope (content + metadata sealed together).
- `src/lib/protocol.ts` — wire protocol shared by client and server (validation, CAS mapping).
- `src/lib/room.svelte.ts` — client polling sync + optimistic-CAS writes.
- `src/lib/clipboard.ts` — gesture-safe clipboard read/write.
- `src/routes/api/room/[k1]/…` — the dumb conditional R2 blob store; R2 binding is `BUCKET`.

The secret never leaves the browser: only `K1` (room address) and ciphertext are sent. `S` MUST
come from `crypto.randomUUID()` (CSPRNG) — see the comment in `src/routes/+page.svelte`.

## UI

Styled with **Tailwind CSS v4** (`@tailwindcss/vite`, plus the `forms` and `typography` plugins).

Components from **[Bits UI](https://bits-ui.com)** (headless Svelte components). Docs for LLMs: https://bits-ui.com/docs/llms.txt

## Package manager

Use **bun** for all dependency and script commands (`bun install`, `bun run <script>`).

## Before committing

Run format, lint, and check, and ensure all pass:

```sh
bun run format   # prettier --write
bun run lint     # prettier --check + eslint
bun run check    # svelte-kit sync + svelte-check (type/Svelte diagnostics)
bun run test     # vitest — crypto / envelope / protocol unit tests
```

## Deploy

`bun run deploy` builds and runs `wrangler deploy`. The R2 bucket must exist first:
`wrangler r2 bucket create pasteslots`.

After editing `wrangler.jsonc` bindings, run `bun run cf-typegen` to regenerate
`src/worker-configuration.d.ts`.
