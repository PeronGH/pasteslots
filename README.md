# Paste Slots

An end-to-end encrypted, cross-device pasteboard. A "room" holds **4 fixed slots**; each can
hold text, HTML, or a PNG image copied from your clipboard. Content is encrypted in the browser
before it reaches the server, so the operator stores and syncs it without being able to read it.

Runs entirely on **Cloudflare Workers + R2** (no Durable Objects, no database, no accounts).

## How it works

- The secret `S` is a CSPRNG `crypto.randomUUID()` carried in the URL **fragment** (`https://app/#<S>`).
  The fragment is never sent to the server, so the server never sees `S`.
- Three values are derived from `S` with HKDF-SHA256: an **Ed25519 signing seed** `sk`
  (`info="auth"`), the room address `K1 = pub(sk)` (the Ed25519 public key, sent to the server),
  and `K2` (the AES-256-GCM content key, `info="enc"`). `sk` and `K2` never leave the browser.
- Each slot is `IV ‖ AES-256-GCM(K2, msgpack({ mime, content }))`. The MIME type is sealed
  together with the content, so the server stores only opaque ciphertext keyed by `K1/0…K1/3`.
- The server (SvelteKit endpoints under `src/routes/api/room/`) is a dumb blob store: list, get,
  and optimistic-CAS put. It holds no key. Each write carries an **Ed25519 signature** over
  `slot ‖ E_prev ‖ SHA-256(body)`, which the server verifies against `K1` before the put — so a
  capture-capable network attacker can't forge a write or roll a slot back by swapping the
  cleartext CAS etag. Clearing a slot writes an encrypted tombstone via the same signed CAS put
  (R2's delete has no compare-and-swap), so it can't clobber a concurrent write.
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
confirm this in DevTools). Writes are Ed25519-signed, so even a capture-capable network attacker
(e.g. a TLS-intercepting proxy) can't forge writes or roll a slot back to old ciphertext, assuming
the operator is honest. It does not hide metadata (slot sizes, timestamps, which slots are
occupied, the room address), and it is not designed to withstand a malicious operator or a local
attacker.
