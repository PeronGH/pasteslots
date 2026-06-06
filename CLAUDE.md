# CLAUDE.md

SvelteKit app deployed on **Cloudflare Workers** (`@sveltejs/adapter-cloudflare`, config in `wrangler.jsonc`).

End-to-end encrypted 4-slot pasteboard; see `README.md` for the design. Key modules:

- `src/lib/crypto.ts` — HKDF derivation of `sk` (Ed25519 signing seed, `info="auth"`), `K1 = pub(sk)`
  (room address + write-verify key), and `K2` (content key, `info="enc"`); AES-GCM seal/open;
  Ed25519 `signWrite`/`verifyWrite` over `slot ‖ E_prev ‖ SHA-256(body)` (via `@noble/ed25519`).
- `src/lib/envelope.ts` — MessagePack slot envelope (content + metadata sealed together).
- `src/lib/protocol.ts` — wire protocol shared by client and server (validation, CAS mapping, headers).
- `src/lib/room.svelte.ts` — client polling sync + signed optimistic-CAS writes.
- `src/lib/clipboard.ts` — gesture-safe clipboard read/write.
- `src/routes/api/room/[k1]/…` — the dumb R2 blob store; `PUT` verifies the write signature before
  the conditional put. R2 binding is `BUCKET`.

The secret never leaves the browser: only `K1` (the public room address) and ciphertext are sent;
`sk` and `K2` stay local. `S` MUST come from `crypto.randomUUID()` (CSPRNG) — see the comment in
`src/routes/+page.svelte`.

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
