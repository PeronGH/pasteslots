# Paste Slots

An end-to-end encrypted, cross-device pasteboard. A "room" holds **4 fixed slots**; each can
hold text, HTML, or a PNG image copied from your clipboard. Content is encrypted in the browser
before it reaches the server, so the operator stores and syncs it without being able to read it.

Runs entirely on **Cloudflare Workers + R2** (no Durable Objects, no database, no accounts).

## How it works

- The secret `S` is a CSPRNG `crypto.randomUUID()` carried in the URL **fragment** (`https://app/#<S>`).
  The fragment is never sent to the server, so the server never sees `S`.
- Two independent keys are derived from `S` with HKDF-SHA256: `K1` (the room address, sent to the
  server) and `K2` (the AES-256-GCM key, which never leaves the browser).
- Each slot is `IV ‖ AES-256-GCM(K2, msgpack({ mime, label, content }))`. Content **and** metadata
  are sealed together, so the server stores only opaque ciphertext keyed by `K1/0…K1/3`.
- The server (SvelteKit endpoints under `src/routes/api/room/`) is a dumb conditional blob store:
  list, get, optimistic-CAS put, delete. It performs no auth and holds no key.
- Clients poll `list` and decrypt only the slots whose etag changed.

**The URL is the capability.** Anyone with the link has full read & write access; there is no
login and no revocation short of clearing the slots. A lost URL means a lost room.

## Usage

Open the app; a room with a fresh secret is created automatically and written into the URL
fragment. Use **Paste** to put your clipboard into a slot and **Copy** to read it back. Open the
same URL on another device to sync.

## Develop

```sh
bun install
bun run dev      # local R2 is simulated by Miniflare — no real bucket needed
bun run test     # crypto / envelope / protocol unit tests
bun run check    # type + Svelte diagnostics
```

## Deploy

```sh
wrangler r2 bucket create pasteslots   # one-time; binding BUCKET in wrangler.jsonc
bun run deploy                         # vite build && wrangler deploy
```

## Scope

Everything is encrypted in your browser with a key derived from the URL fragment, which never
leaves the page — the server only ever stores the room address `K1` and ciphertext (you can
confirm this in DevTools). It does not hide metadata (slot sizes, timestamps, which slots are
occupied, the room address), and it is not designed to withstand a determined, targeted, or local
attacker.
