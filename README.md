# Paste Slots

An end-to-end encrypted, cross-device pasteboard. A "room" holds **4 fixed slots**, each holding
text, HTML, or a PNG image from your clipboard. Content is encrypted in the browser before it
reaches the server, which stores and syncs only ciphertext. Runs entirely on **Cloudflare Workers
and R2** — no Durable Objects, database, or accounts.

## How it works

- The secret `S` is a CSPRNG UUID in the URL **fragment** (`https://app/#<S>`), which browsers
  never send to the server.
- The client derives three values from `S` with HKDF-SHA256: an Ed25519 seed `sk`, the room
  address `K1 = pub(sk)`, and an AES-256-GCM key `K2`. Only `K1` and ciphertext are ever
  transmitted; `S`, `sk`, and `K2` never leave the page.
- Each slot is `IV ‖ AES-256-GCM(K2, msgpack({ mime, content }))`, with the slot index as GCM
  additional authenticated data.
- Every request (read, list, write) carries an Ed25519 signature over
  `method ‖ path ‖ timestamp ‖ E_prev ‖ SHA-256(body)`, verified against `K1`.
- The server is a dumb R2 blob store — list, get, optimistic-CAS put — and holds no key. Clearing
  a slot writes an encrypted tombstone (R2's delete has no compare-and-swap).

**The URL is the capability**: anyone with it has full read/write access; there's no login and no
revocation, and a lost URL is a lost room. A compromised local device is out of scope.

## Usage

Open the app; a room with a fresh secret is created and written into the URL fragment. **Paste**
puts your clipboard into a slot, **Copy** reads it back. Open the same URL on another device to sync.

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
