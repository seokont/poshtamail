# Mail Client (Nuxt + Vercel + Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-user Nuxt mail client described in the spec — 4 IMAP/SMTP mailboxes synced into Supabase Postgres, browser UI with Supabase Auth + Realtime, SMTP send via a Nitro API route, IMAP sync via a Vercel Cron-triggered Nitro API route.

**Architecture:** Nuxt 4 app (`app/` dir for pages/composables) with a Nitro server (`server/`) that owns all Supabase `service_role` access and all IMAP/SMTP credentials. Business logic that touches external services (Supabase queries, IMAP, SMTP) is factored into small pure-ish functions in `server/utils/*` that accept an injected client, so they're unit-testable with mocks; the `server/api/*` route files stay thin wrappers that do auth/header checks and call those functions. The browser talks to Supabase directly with the `anon` key for reads (protected by RLS) and calls Nitro routes for writes that need secrets (send mail, download attachment via signed URL).

**Tech Stack:** Nuxt 4, `@nuxtjs/supabase`, `@supabase/supabase-js`, `nodemailer`, `imapflow`, `mailparser`, TypeScript, Vitest + `@nuxt/test-utils` (component tests use `mountSuspended`/`mockNuxtImport`), deployed to Vercel with `vercel.json` cron.

**Spec:** [mail-client-vercel-supabase_1.md](../../../mail-client-vercel-supabase_1.md)

## Global Constraints

- Package manager: npm (spec's install commands use `npm i` / `npx nuxi`).
- Node/Nuxt: Nuxt 4 (default `app/` src dir — matches spec's `app/pages`, `app/composables` layout without extra `srcDir` config).
- Env vars, exact names (spec §10): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MAIL_ENCRYPTION_KEY` (32 bytes hex), `CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` must never be imported into client-side code — only `server/utils/*` and `server/api/*` may reference it.
- IMAP/SMTP passwords are stored only as AES-256-GCM ciphertext (`imap_password_encrypted`, `smtp_password_encrypted`) — never logged, never returned from any API response.
- RLS is mandatory on `mailboxes`, `mailbox_access`, `folders`, `messages`, `attachments`, and on the `attachments` Storage bucket (spec §3, §4) — the browser must never be able to read another user's mailbox even with the anon key.
- `server/api/cron/sync.ts` must reject any request whose `Authorization` header isn't exactly `Bearer $CRON_SECRET` (spec §5).
- Nuxt project structure follows spec §5: `app/pages`, `app/composables`, `server/api/mail`, `server/api/cron`, `server/utils`.
- `vercel.json` cron schedule: `*/5 * * * *` on `/api/cron/sync` (spec §5), documented as requiring Vercel Pro (spec §2).

---

## File Structure

```
D:\post_client\
├── package.json
├── nuxt.config.ts
├── tsconfig.json
├── vitest.config.ts
├── vercel.json
├── .env.example
├── .gitignore
├── README.md
├── supabase/
│   └── migrations/
│       └── 0001_init.sql
├── app/
│   ├── app.vue
│   ├── pages/
│   │   ├── login.vue
│   │   ├── confirm.vue
│   │   ├── index.vue
│   │   └── mail/
│   │       └── [id].vue
│   └── composables/
│       └── useMailRealtime.ts
├── server/
│   ├── api/
│   │   ├── mail/
│   │   │   ├── send.post.ts
│   │   │   └── list.get.ts
│   │   ├── attachments/
│   │   │   └── [id]/
│   │   │       └── download.get.ts
│   │   └── cron/
│   │       └── sync.ts
│   └── utils/
│       ├── crypto.ts
│       ├── supabaseAdmin.ts
│       ├── cronAuth.ts
│       ├── mailboxAccess.ts
│       ├── imap.ts
│       ├── mailSync.ts
│       ├── sendMail.ts
│       ├── listMail.ts
│       └── attachmentDownload.ts
└── test/
    ├── crypto.test.ts
    ├── supabaseAdmin.test.ts
    ├── cronAuth.test.ts
    ├── mailboxAccess.test.ts
    ├── imap.test.ts
    ├── mailSync.test.ts
    ├── sendMail.test.ts
    ├── listMail.test.ts
    ├── attachmentDownload.test.ts
    ├── login.page.test.ts
    ├── useMailRealtime.test.ts
    ├── index.page.test.ts
    └── mail-id.page.test.ts
```

Each `server/utils/*.ts` has one responsibility and takes its Supabase client (or IMAP/SMTP factory) as a parameter instead of importing a global singleton, so tests can pass in mocks without touching real credentials or the network. `server/api/*` routes only wire together: auth check → call util → return/redirect.

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `nuxt.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `app/app.vue`
- Create: `app/pages/index.vue` (placeholder, replaced in Task 12)

**Interfaces:**
- Produces: a buildable Nuxt 4 project with `@nuxtjs/supabase` module configured (`url`, `key`, `serviceKey`, `redirectOptions.login = '/login'`, `redirectOptions.callback = '/confirm'`, `redirectOptions.exclude = ['/login', '/confirm']`) that every later task's pages/routes rely on; a working `npm run test` (Vitest, environment `nuxt`) and `npm run build` command.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "mail-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "typecheck": "nuxi typecheck",
    "test": "vitest run"
  },
  "dependencies": {
    "nuxt": "^4.0.0",
    "vue": "^3.5.0",
    "@nuxtjs/supabase": "^1.4.0",
    "@supabase/supabase-js": "^2.45.0",
    "nodemailer": "^6.9.0",
    "imapflow": "^1.0.0",
    "mailparser": "^3.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/mailparser": "^3.4.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@nuxt/test-utils": "^3.14.0",
    "@vue/test-utils": "^2.4.0",
    "happy-dom": "^15.0.0"
  }
}
```

- [ ] **Step 2: Write `nuxt.config.ts`**

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-08-19',
  modules: ['@nuxtjs/supabase'],
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/confirm']
    }
  }
})
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt'
  }
})
```

- [ ] **Step 5: Write `.env.example`**

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAIL_ENCRYPTION_KEY=
CRON_SECRET=
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
.nuxt
.output
.env
dist
```

- [ ] **Step 7: Write `app/app.vue`**

```vue
<template>
  <NuxtPage />
</template>
```

- [ ] **Step 8: Write placeholder `app/pages/index.vue`**

```vue
<template>
  <main>
    <h1>Mail Client</h1>
  </main>
</template>
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: exits 0, `node_modules` and `package-lock.json` created.

- [ ] **Step 10: Verify the scaffold builds**

Run (Windows PowerShell):
```powershell
$env:SUPABASE_URL = "https://example.supabase.co"; $env:SUPABASE_ANON_KEY = "dummy"; $env:SUPABASE_SERVICE_ROLE_KEY = "dummy"; npm run build
```
Expected: exits 0, output includes a Nitro build success line (e.g. `Nitro built`). This is the scaffold's pass/fail gate — later tasks add real logic and tests.

- [ ] **Step 11: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Nuxt 4 mail client project"
```

---

### Task 2: Supabase SQL migration (schema + RLS + Storage policy)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: the full Postgres schema (`profiles`, `mailboxes`, `mailbox_access`, `folders`, `messages`, `attachments`) plus RLS policies and the private `attachments` Storage bucket, that every `server/utils/*` task below assumes exists.

There is no automated test for this task — RLS/Storage policy correctness can only be verified against a live Postgres instance, which this session doesn't have. The verification step is a manual checklist to run once a real Supabase project exists (spec §12 step 1–2).

- [ ] **Step 1: Write `supabase/migrations/0001_init.sql`**

```sql
-- Core tables (spec §3)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz default now()
);

create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  imap_host text not null,
  imap_port int not null default 993,
  smtp_host text not null,
  smtp_port int not null default 465,
  imap_password_encrypted text not null,
  smtp_password_encrypted text not null,
  last_uid_seen bigint not null default 0,
  created_at timestamptz default now()
);

create table public.mailbox_access (
  user_id uuid references auth.users(id) on delete cascade,
  mailbox_id uuid references public.mailboxes(id) on delete cascade,
  role text not null default 'owner',
  primary key (user_id, mailbox_id)
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.mailboxes(id) on delete cascade,
  name text not null,
  unique (mailbox_id, name)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.mailboxes(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  imap_uid bigint not null,
  message_id text,
  from_addr text,
  to_addrs text[],
  subject text,
  body_text text,
  body_html text,
  is_read boolean not null default false,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mailbox_id, folder_id, imap_uid)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  filename text,
  content_type text,
  storage_path text,
  size_bytes int
);

-- Row Level Security (spec §3)
alter table public.mailboxes enable row level security;
alter table public.mailbox_access enable row level security;
alter table public.folders enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;

create policy "user sees own mailboxes"
  on public.mailboxes for select
  using (
    exists (
      select 1 from public.mailbox_access ma
      where ma.mailbox_id = mailboxes.id and ma.user_id = auth.uid()
    )
  );

create policy "user sees own mailbox_access rows"
  on public.mailbox_access for select
  using (user_id = auth.uid());

create policy "user sees folders of own mailboxes"
  on public.folders for select
  using (
    exists (
      select 1 from public.mailbox_access ma
      where ma.mailbox_id = folders.mailbox_id and ma.user_id = auth.uid()
    )
  );

create policy "user sees own messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.mailbox_access ma
      where ma.mailbox_id = messages.mailbox_id and ma.user_id = auth.uid()
    )
  );

create policy "user updates own messages"
  on public.messages for update
  using (
    exists (
      select 1 from public.mailbox_access ma
      where ma.mailbox_id = messages.mailbox_id and ma.user_id = auth.uid()
    )
  );

create policy "user sees attachments of own messages"
  on public.attachments for select
  using (
    exists (
      select 1 from public.messages m
      join public.mailbox_access ma on ma.mailbox_id = m.mailbox_id
      where m.id = attachments.message_id and ma.user_id = auth.uid()
    )
  );

-- Storage: private "attachments" bucket. Objects are stored under
-- `<mailbox_id>/<imap_uid>/<filename>`, so the top-level path segment is
-- the mailbox id and mailbox_access can gate reads directly.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "user reads own mailbox attachments"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.mailbox_access ma
      where ma.mailbox_id::text = (storage.foldername(name))[1]
        and ma.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Manual verification checklist (run once a Supabase project exists — not part of this coding session)**

1. Open the Supabase project's SQL editor, paste the file contents, run it.
2. Confirm all 6 tables exist under `public` and `storage.buckets` has an `attachments` row with `public = false`.
3. As an authenticated test user with no `mailbox_access` row, confirm `select * from mailboxes` returns 0 rows (RLS blocking).
4. Insert a `mailbox_access` row for that user, confirm the matching mailbox/messages/attachments become visible.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add Supabase schema, RLS policies and attachments bucket policy"
```

---

### Task 3: Encryption utility (`crypto.ts`)

**Files:**
- Create: `server/utils/crypto.ts`
- Test: `test/crypto.test.ts`

**Interfaces:**
- Produces: `encrypt(text: string): string`, `decrypt(payload: string): string` — used by Task 6 (`mailSync.ts`) and Task 7 (`sendMail.ts`) to decrypt `imap_password_encrypted` / `smtp_password_encrypted`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/crypto.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decrypt, encrypt } from '../server/utils/crypto'

describe('crypto', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('super-secret-password')
    expect(decrypt(ciphertext)).toBe('super-secret-password')
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encrypt('same-input')
    const b = encrypt('same-input')
    expect(a).not.toBe(b)
  })

  it('throws if the ciphertext was tampered with', () => {
    const ciphertext = encrypt('super-secret-password')
    const buf = Buffer.from(ciphertext, 'base64')
    buf[buf.length - 1] ^= 0xff // flip last byte of the encrypted payload
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws when MAIL_ENCRYPTION_KEY is not set', () => {
    delete process.env.MAIL_ENCRYPTION_KEY
    expect(() => encrypt('x')).toThrow('MAIL_ENCRYPTION_KEY')
  })

  it('throws when MAIL_ENCRYPTION_KEY is not 32 bytes', () => {
    process.env.MAIL_ENCRYPTION_KEY = '1234'
    expect(() => encrypt('x')).toThrow('32 bytes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/crypto.test.ts`
Expected: FAIL — `server/utils/crypto.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function getKey(): Buffer {
  const hex = process.env.MAIL_ENCRYPTION_KEY
  if (!hex) throw new Error('MAIL_ENCRYPTION_KEY must be set')
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return key
}

export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(payload: string): string {
  const key = getKey()
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/crypto.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/crypto.ts test/crypto.test.ts
git commit -m "feat: add AES-256-GCM encrypt/decrypt utility for mailbox passwords"
```

---

### Task 4: Server auth utilities (`supabaseAdmin.ts`, `cronAuth.ts`, `mailboxAccess.ts`)

**Files:**
- Create: `server/utils/supabaseAdmin.ts`
- Create: `server/utils/cronAuth.ts`
- Create: `server/utils/mailboxAccess.ts`
- Test: `test/supabaseAdmin.test.ts`
- Test: `test/cronAuth.test.ts`
- Test: `test/mailboxAccess.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getSupabaseAdmin(): SupabaseClient` (lazy singleton, service-role client — used by every `server/api/*` route from Task 6 onward), `assertCronAuthorized(authHeader: string | undefined | null, secret: string | undefined): void` (used by Task 6's `sync.ts` route), `assertMailboxAccess(admin: SupabaseClient, userId: string, mailboxId: string): Promise<void>` (used by Task 6, 7, 8, 9).

- [ ] **Step 1: Write the failing tests**

```ts
// test/supabaseAdmin.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() }))
}))

describe('getSupabaseAdmin', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('throws when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing', async () => {
    const { getSupabaseAdmin } = await import('../server/utils/supabaseAdmin')
    expect(() => getSupabaseAdmin()).toThrow(/SUPABASE_URL/)
  })

  it('returns a client once env vars are set, and reuses it', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const { getSupabaseAdmin } = await import('../server/utils/supabaseAdmin')
    const a = getSupabaseAdmin()
    const b = getSupabaseAdmin()
    expect(a).toBe(b)
    expect(typeof a.from).toBe('function')
  })
})
```

```ts
// test/cronAuth.test.ts
import { describe, expect, it } from 'vitest'
import { assertCronAuthorized } from '../server/utils/cronAuth'

describe('assertCronAuthorized', () => {
  it('throws if CRON_SECRET is not configured', () => {
    expect(() => assertCronAuthorized('Bearer x', undefined)).toThrow('CRON_SECRET')
  })

  it('throws a 401 when the header does not match', () => {
    try {
      assertCronAuthorized('Bearer wrong', 'right-secret')
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err.statusCode).toBe(401)
    }
  })

  it('does not throw when the header matches', () => {
    expect(() => assertCronAuthorized('Bearer right-secret', 'right-secret')).not.toThrow()
  })
})
```

```ts
// test/mailboxAccess.test.ts
import { describe, expect, it, vi } from 'vitest'
import { assertMailboxAccess } from '../server/utils/mailboxAccess'

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn(() => ({ maybeSingle }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  return { from } as any
}

describe('assertMailboxAccess', () => {
  it('resolves when an access row exists', async () => {
    const admin = fakeAdmin({ data: { mailbox_id: 'mb-1' }, error: null })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).resolves.toBeUndefined()
  })

  it('throws 403 when no access row exists', async () => {
    const admin = fakeAdmin({ data: null, error: null })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 500 on a query error', async () => {
    const admin = fakeAdmin({ data: null, error: { message: 'db down' } })
    await expect(assertMailboxAccess(admin, 'user-1', 'mb-1')).rejects.toMatchObject({ statusCode: 500 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/supabaseAdmin.test.ts test/cronAuth.test.ts test/mailboxAccess.test.ts`
Expected: FAIL — none of the three util files exist yet.

- [ ] **Step 3: Write the implementations**

```ts
// server/utils/supabaseAdmin.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return client
}
```

```ts
// server/utils/cronAuth.ts
export function assertCronAuthorized(authHeader: string | undefined | null, secret: string | undefined): void {
  if (!secret) {
    throw new Error('CRON_SECRET is not configured')
  }
  if (authHeader !== `Bearer ${secret}`) {
    const err = new Error('Unauthorized cron request') as Error & { statusCode: number }
    err.statusCode = 401
    throw err
  }
}
```

```ts
// server/utils/mailboxAccess.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export async function assertMailboxAccess(admin: SupabaseClient, userId: string, mailboxId: string): Promise<void> {
  const { data, error } = await admin
    .from('mailbox_access')
    .select('mailbox_id')
    .eq('user_id', userId)
    .eq('mailbox_id', mailboxId)
    .maybeSingle()

  if (error) {
    const err = new Error(error.message) as Error & { statusCode: number }
    err.statusCode = 500
    throw err
  }
  if (!data) {
    const err = new Error('Forbidden: no access to this mailbox') as Error & { statusCode: number }
    err.statusCode = 403
    throw err
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/supabaseAdmin.test.ts test/cronAuth.test.ts test/mailboxAccess.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/supabaseAdmin.ts server/utils/cronAuth.ts server/utils/mailboxAccess.ts test/supabaseAdmin.test.ts test/cronAuth.test.ts test/mailboxAccess.test.ts
git commit -m "feat: add supabase admin client, cron auth guard and mailbox access check"
```

---

### Task 5: IMAP helpers (`imap.ts`)

**Files:**
- Create: `server/utils/imap.ts`
- Test: `test/imap.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (only `@supabase/supabase-js` types).
- Produces: `MailboxRow` type, `buildImapConfig(mailbox: MailboxRow, password: string)`, `ensureFolderId(admin: SupabaseClient, mailboxId: string, name: string): Promise<string>` — both used by Task 6 (`mailSync.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// test/imap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildImapConfig, ensureFolderId, type MailboxRow } from '../server/utils/imap'

const mailbox: MailboxRow = {
  id: 'mb-1',
  email: 'inbox1@example.com',
  imap_host: 'imap.example.com',
  imap_port: 993,
  smtp_host: 'smtp.example.com',
  smtp_port: 465
}

describe('buildImapConfig', () => {
  it('maps a mailbox row + decrypted password into an ImapFlow config', () => {
    expect(buildImapConfig(mailbox, 'plain-password')).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: { user: 'inbox1@example.com', pass: 'plain-password' },
      logger: false
    })
  })
})

function fakeAdminForFolders(existing: { id: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
  const eqName = vi.fn(() => ({ maybeSingle }))
  const eqMailbox = vi.fn(() => ({ eq: eqName }))
  const select = vi.fn(() => ({ eq: eqMailbox }))

  const single = vi.fn().mockResolvedValue({ data: { id: 'new-folder-id' }, error: null })
  const insertSelect = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select: insertSelect }))

  const from = vi.fn(() => ({ select, insert }))
  return { from } as any
}

describe('ensureFolderId', () => {
  it('returns the existing folder id without inserting', async () => {
    const admin = fakeAdminForFolders({ id: 'existing-folder-id' })
    await expect(ensureFolderId(admin, 'mb-1', 'INBOX')).resolves.toBe('existing-folder-id')
    expect(admin.from().insert).not.toHaveBeenCalled()
  })

  it('creates the folder when it does not exist yet', async () => {
    const admin = fakeAdminForFolders(null)
    await expect(ensureFolderId(admin, 'mb-1', 'INBOX')).resolves.toBe('new-folder-id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/imap.test.ts`
Expected: FAIL — `server/utils/imap.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/imap.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MailboxRow {
  id: string
  email: string
  imap_host: string
  imap_port: number
  smtp_host: string
  smtp_port: number
}

export function buildImapConfig(mailbox: MailboxRow, password: string) {
  return {
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: true,
    auth: { user: mailbox.email, pass: password },
    logger: false as const
  }
}

export async function ensureFolderId(admin: SupabaseClient, mailboxId: string, name: string): Promise<string> {
  const { data: existing, error: selErr } = await admin
    .from('folders')
    .select('id')
    .eq('mailbox_id', mailboxId)
    .eq('name', name)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)
  if (existing) return existing.id

  const { data: created, error: insErr } = await admin
    .from('folders')
    .insert({ mailbox_id: mailboxId, name })
    .select('id')
    .single()
  if (insErr) throw new Error(insErr.message)
  return created.id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/imap.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/imap.ts test/imap.test.ts
git commit -m "feat: add IMAP config builder and folder-ensure helper"
```

---

### Task 6: IMAP sync (`mailSync.ts` + `server/api/cron/sync.ts`)

**Files:**
- Create: `server/utils/mailSync.ts`
- Create: `server/api/cron/sync.ts`
- Test: `test/mailSync.test.ts`

**Interfaces:**
- Consumes: `buildImapConfig`, `ensureFolderId` from [imap.ts](#task-5-imap-helpers-imapts) (Task 5); `assertCronAuthorized` from [cronAuth.ts](#task-4-server-auth-utilities-supabaseadmints-cronauthts-mailboxaccessts) (Task 4); `getSupabaseAdmin` (Task 4); `decrypt` from [crypto.ts](#task-3-encryption-utility-cryptots) (Task 3).
- Produces: `syncAllMailboxes(admin: SupabaseClient, decrypt: (payload: string) => string): Promise<{ ok: true; synced: number }>`, `syncMailbox(admin, mailbox: SyncableMailbox, decrypt)`.

- [ ] **Step 1: Write the failing test**

```ts
// test/mailSync.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const fetchedMessage = { uid: 101, source: Buffer.from('raw-email') }

const connect = vi.fn().mockResolvedValue(undefined)
const release = vi.fn()
const getMailboxLock = vi.fn().mockResolvedValue({ release })
const logout = vi.fn().mockResolvedValue(undefined)
async function* fetchGenerator() {
  yield fetchedMessage
}
const fetchMock = vi.fn(() => fetchGenerator())

vi.mock('imapflow', () => ({
  // A regular `function` (not an arrow function) is required here: the
  // implementation code calls `new ImapFlow(...)`, and arrow functions
  // can never be invoked with `new` (they have no [[Construct]] slot) —
  // an arrow-function mockImplementation throws "is not a constructor".
  ImapFlow: vi.fn().mockImplementation(function () {
    return {
      connect,
      getMailboxLock,
      fetch: fetchMock,
      logout
    }
  })
}))

vi.mock('mailparser', () => ({
  simpleParser: vi.fn().mockResolvedValue({
    messageId: '<abc@example.com>',
    from: { text: 'sender@example.com' },
    to: { text: 'inbox1@example.com' },
    subject: 'Hello',
    text: 'Hello body',
    html: false,
    date: new Date('2026-08-19T00:00:00Z'),
    attachments: [{ filename: 'a.txt', content: Buffer.from('x'), contentType: 'text/plain', size: 1 }]
  })
}))

import { syncAllMailboxes } from '../server/utils/mailSync'

function fakeAdmin() {
  const upsertSingle = vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null })
  const upsertSelect = vi.fn(() => ({ single: upsertSingle }))
  const upsert = vi.fn(() => ({ select: upsertSelect }))
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn(() => ({ eq: updateEq }))

  const folderMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'folder-1' }, error: null })
  const folderEqName = vi.fn(() => ({ maybeSingle: folderMaybeSingle }))
  const folderEqMailbox = vi.fn(() => ({ eq: folderEqName }))
  const folderSelect = vi.fn(() => ({ eq: folderEqMailbox }))

  const mailboxesSelect = vi.fn().mockResolvedValue({
    data: [{
      id: 'mb-1',
      email: 'inbox1@example.com',
      imap_host: 'imap.example.com',
      imap_port: 993,
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      imap_password_encrypted: 'cipher',
      last_uid_seen: 100
    }],
    error: null
  })

  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'mailboxes') return { select: mailboxesSelect, update }
    if (table === 'folders') return { select: folderSelect }
    if (table === 'messages') return { upsert }
    if (table === 'attachments') return { insert }
    throw new Error(`unexpected table ${table}`)
  })

  return { from, storage: { from: vi.fn(() => ({ upload })) } } as any
}

describe('syncAllMailboxes', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('fetches only UIDs above last_uid_seen, upserts the message, uploads the attachment, and advances last_uid_seen', async () => {
    const admin = fakeAdmin()
    const decrypt = vi.fn().mockReturnValue('plain-password')

    const result = await syncAllMailboxes(admin, decrypt)

    expect(result).toEqual({ ok: true, synced: 1 })
    expect(decrypt).toHaveBeenCalledWith('cipher')
    expect(fetchMock).toHaveBeenCalledWith('101:*', { envelope: true, source: true, uid: true }, { uid: true })
    expect(admin.from('messages').upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox_id: 'mb-1',
        folder_id: 'folder-1',
        imap_uid: 101,
        subject: 'Hello'
      }),
      { onConflict: 'mailbox_id,folder_id,imap_uid' }
    )
    expect(admin.from('mailboxes').update).toHaveBeenCalledWith({ last_uid_seen: 101 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mailSync.test.ts`
Expected: FAIL — `server/utils/mailSync.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/mailSync.ts
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildImapConfig, ensureFolderId, type MailboxRow } from './imap'

export interface SyncableMailbox extends MailboxRow {
  imap_password_encrypted: string
  last_uid_seen: number
}

export async function syncAllMailboxes(
  admin: SupabaseClient,
  decrypt: (payload: string) => string
): Promise<{ ok: true; synced: number }> {
  const { data: mailboxes, error } = await admin.from('mailboxes').select('*')
  if (error) throw new Error(error.message)

  for (const mailbox of (mailboxes ?? []) as SyncableMailbox[]) {
    await syncMailbox(admin, mailbox, decrypt)
  }

  return { ok: true, synced: mailboxes?.length ?? 0 }
}

export async function syncMailbox(
  admin: SupabaseClient,
  mailbox: SyncableMailbox,
  decrypt: (payload: string) => string
): Promise<void> {
  const client = new ImapFlow(buildImapConfig(mailbox, decrypt(mailbox.imap_password_encrypted)))
  await client.connect()

  try {
    const lock = await client.getMailboxLock('INBOX')

    try {
      const folderId = await ensureFolderId(admin, mailbox.id, 'INBOX')
      const uidRange = `${mailbox.last_uid_seen + 1}:*`
      let maxUid = mailbox.last_uid_seen

      // The third argument ({ uid: true }) is required so ImapFlow treats
      // `uidRange` as a UID range, not a sequence-number range — those are
      // different addressing spaces (sequence numbers shift as mail is
      // deleted; UIDs don't). The query object's `uid: true` (second arg)
      // only controls whether the UID is included in each result; it does
      // not affect how the range itself is interpreted.
      for await (const msg of client.fetch(uidRange, { envelope: true, source: true, uid: true }, { uid: true })) {
        if (msg.uid <= mailbox.last_uid_seen) continue
        const parsed = await simpleParser(msg.source)

        const { data: inserted, error: upsertErr } = await admin
          .from('messages')
          .upsert({
            mailbox_id: mailbox.id,
            folder_id: folderId,
            imap_uid: msg.uid,
            message_id: parsed.messageId,
            from_addr: parsed.from?.text,
            to_addrs: parsed.to ? [parsed.to.text] : [],
            subject: parsed.subject,
            body_text: parsed.text,
            body_html: parsed.html || null,
            received_at: parsed.date
          }, { onConflict: 'mailbox_id,folder_id,imap_uid' })
          .select('id')
          .single()

        if (upsertErr) throw new Error(upsertErr.message)

        for (const att of parsed.attachments ?? []) {
          const path = `${mailbox.id}/${msg.uid}/${att.filename}`
          const { error: uploadErr } = await admin.storage.from('attachments').upload(path, att.content, {
            contentType: att.contentType,
            upsert: true
          })
          if (uploadErr) throw new Error(uploadErr.message)

          const { error: attachInsertErr } = await admin.from('attachments').insert({
            message_id: inserted.id,
            filename: att.filename,
            content_type: att.contentType,
            storage_path: path,
            size_bytes: att.size
          })
          if (attachInsertErr) throw new Error(attachInsertErr.message)
        }

        maxUid = Math.max(maxUid, msg.uid)
      }

      if (maxUid > mailbox.last_uid_seen) {
        await admin.from('mailboxes').update({ last_uid_seen: maxUid }).eq('id', mailbox.id)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}
```

```ts
// server/api/cron/sync.ts
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { assertCronAuthorized } from '../../utils/cronAuth'
import { syncAllMailboxes } from '../../utils/mailSync'
import { decrypt } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  assertCronAuthorized(getHeader(event, 'authorization'), process.env.CRON_SECRET)
  return await syncAllMailboxes(getSupabaseAdmin(), decrypt)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mailSync.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add server/utils/mailSync.ts server/api/cron/sync.ts test/mailSync.test.ts
git commit -m "feat: add IMAP sync logic and protected cron endpoint"
```

---

### Task 7: Send mail (`sendMail.ts` + `server/api/mail/send.post.ts`)

**Files:**
- Create: `server/utils/sendMail.ts`
- Create: `server/api/mail/send.post.ts`
- Test: `test/sendMail.test.ts`

**Interfaces:**
- Consumes: `assertMailboxAccess` (Task 4), `decrypt` (Task 3).
- Produces: `sendMailForUser(admin, userId, params: SendMailParams, createTransport?): Promise<{ ok: true }>` — used directly by the route; also the shape the compose form in Task 13 (`mail/[id].vue`) POSTs to `/api/mail/send`.

- [ ] **Step 1: Write the failing test**

```ts
// test/sendMail.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt } from '../server/utils/crypto'
import { sendMailForUser } from '../server/utils/sendMail'

function fakeAdmin(opts: { hasAccess: boolean; smtpPasswordEncrypted: string }) {
  const accessMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.hasAccess ? { mailbox_id: 'mb-1' } : null,
    error: null
  })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const mailboxSingle = vi.fn().mockResolvedValue({
    data: {
      email: 'inbox1@example.com',
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_password_encrypted: opts.smtpPasswordEncrypted
    },
    error: null
  })
  const mailboxEq = vi.fn(() => ({ single: mailboxSingle }))
  const mailboxSelect = vi.fn(() => ({ eq: mailboxEq }))

  const from = vi.fn((table: string) => {
    if (table === 'mailbox_access') return { select: accessSelect }
    if (table === 'mailboxes') return { select: mailboxSelect }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as any
}

describe('sendMailForUser', () => {
  beforeEach(() => {
    process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })

  it('rejects when the user has no access to the mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: false, smtpPasswordEncrypted: encrypt('pw') })
    await expect(
      sendMailForUser(admin, 'user-1', { mailboxId: 'mb-1', to: 'x@y.com', subject: 'Hi' })
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('sends mail through nodemailer using the decrypted SMTP password', async () => {
    const admin = fakeAdmin({ hasAccess: true, smtpPasswordEncrypted: encrypt('smtp-secret') })
    const sendMail = vi.fn().mockResolvedValue({})
    const createTransport = vi.fn().mockReturnValue({ sendMail })

    const result = await sendMailForUser(
      admin,
      'user-1',
      { mailboxId: 'mb-1', to: 'x@y.com', subject: 'Hi', text: 'body' },
      createTransport as any
    )

    expect(result).toEqual({ ok: true })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'inbox1@example.com', pass: 'smtp-secret' }
      })
    )
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'inbox1@example.com', to: 'x@y.com', subject: 'Hi', text: 'body' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sendMail.test.ts`
Expected: FAIL — `server/utils/sendMail.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/sendMail.ts
import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMailboxAccess } from './mailboxAccess'
import { decrypt } from './crypto'

export interface SendMailParams {
  mailboxId: string
  to: string
  subject: string
  text?: string
  html?: string
}

export type TransporterFactory = typeof nodemailer.createTransport

export async function sendMailForUser(
  admin: SupabaseClient,
  userId: string,
  params: SendMailParams,
  createTransport: TransporterFactory = nodemailer.createTransport
): Promise<{ ok: true }> {
  await assertMailboxAccess(admin, userId, params.mailboxId)

  const { data: mailbox, error } = await admin
    .from('mailboxes')
    .select('email, smtp_host, smtp_port, smtp_password_encrypted')
    .eq('id', params.mailboxId)
    .single()
  if (error || !mailbox) {
    const err = new Error('Mailbox not found') as Error & { statusCode: number }
    err.statusCode = 404
    throw err
  }

  const transporter = createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_port === 465,
    auth: {
      user: mailbox.email,
      pass: decrypt(mailbox.smtp_password_encrypted)
    }
  })

  await transporter.sendMail({
    from: mailbox.email,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html
  })

  return { ok: true }
}
```

```ts
// server/api/mail/send.post.ts
import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { sendMailForUser } from '../../utils/sendMail'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  if (!body?.mailboxId || !body?.to || !body?.subject) {
    throw createError({ statusCode: 400, statusMessage: 'mailboxId, to and subject are required' })
  }

  return await sendMailForUser(getSupabaseAdmin(), user.id, {
    mailboxId: body.mailboxId,
    to: body.to,
    subject: body.subject,
    text: body.text,
    html: body.html
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sendMail.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/sendMail.ts server/api/mail/send.post.ts test/sendMail.test.ts
git commit -m "feat: add SMTP send logic and /api/mail/send endpoint"
```

---

### Task 8: List messages (`listMail.ts` + `server/api/mail/list.get.ts`)

**Files:**
- Create: `server/utils/listMail.ts`
- Create: `server/api/mail/list.get.ts`
- Test: `test/listMail.test.ts`

**Interfaces:**
- Consumes: `assertMailboxAccess` (Task 4).
- Produces: `listMessages(admin, userId, params: { mailboxId: string; limit?: number; offset?: number })` — an optional server-side alternative to the client reading Supabase directly (spec §5 marks `list.get.ts` optional; kept for parity and for any caller that can't use the anon key directly).

- [ ] **Step 1: Write the failing test**

```ts
// test/listMail.test.ts
import { describe, expect, it, vi } from 'vitest'
import { listMessages } from '../server/utils/listMail'

function fakeAdmin(rows: unknown[]) {
  const accessMaybeSingle = vi.fn().mockResolvedValue({ data: { mailbox_id: 'mb-1' }, error: null })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const range = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn(() => ({ range }))
  const eq = vi.fn(() => ({ order }))
  const messagesSelect = vi.fn(() => ({ eq }))

  const from = vi.fn((table: string) => {
    if (table === 'mailbox_access') return { select: accessSelect }
    if (table === 'messages') return { select: messagesSelect }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, range, order, eq } as any
}

describe('listMessages', () => {
  it('returns messages for a mailbox the user can access, newest first, paginated', async () => {
    const rows = [{ id: 'm1' }, { id: 'm2' }]
    const admin = fakeAdmin(rows)

    const result = await listMessages(admin, 'user-1', { mailboxId: 'mb-1', limit: 20, offset: 0 })

    expect(result).toEqual(rows)
    expect(admin.order).toHaveBeenCalledWith('received_at', { ascending: false })
    expect(admin.range).toHaveBeenCalledWith(0, 19)
  })

  it('defaults limit to 50 and offset to 0', async () => {
    const admin = fakeAdmin([])
    await listMessages(admin, 'user-1', { mailboxId: 'mb-1' })
    expect(admin.range).toHaveBeenCalledWith(0, 49)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/listMail.test.ts`
Expected: FAIL — `server/utils/listMail.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/listMail.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMailboxAccess } from './mailboxAccess'

export interface ListMessagesParams {
  mailboxId: string
  limit?: number
  offset?: number
}

export async function listMessages(admin: SupabaseClient, userId: string, params: ListMessagesParams) {
  await assertMailboxAccess(admin, userId, params.mailboxId)

  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const { data, error } = await admin
    .from('messages')
    .select('id, mailbox_id, from_addr, subject, is_read, received_at')
    .eq('mailbox_id', params.mailboxId)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    const err = new Error(error.message) as Error & { statusCode: number }
    err.statusCode = 500
    throw err
  }
  return data ?? []
}
```

```ts
// server/api/mail/list.get.ts
import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { listMessages } from '../../utils/listMail'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const query = getQuery(event)
  const mailboxId = String(query.mailboxId || '')
  if (!mailboxId) throw createError({ statusCode: 400, statusMessage: 'mailboxId is required' })

  return await listMessages(getSupabaseAdmin(), user.id, {
    mailboxId,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/listMail.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/listMail.ts server/api/mail/list.get.ts test/listMail.test.ts
git commit -m "feat: add optional server-side message listing endpoint"
```

---

### Task 9: Attachment download (`attachmentDownload.ts` + `server/api/attachments/[id]/download.get.ts`)

**Files:**
- Create: `server/utils/attachmentDownload.ts`
- Create: `server/api/attachments/[id]/download.get.ts`
- Test: `test/attachmentDownload.test.ts`

**Interfaces:**
- Consumes: `assertMailboxAccess` (Task 4).
- Produces: `getAttachmentSignedUrl(admin, userId, attachmentId): Promise<{ url: string; filename: string | null }>` — used by the attachment links rendered in Task 13 (`mail/[id].vue`).

- [ ] **Step 1: Write the failing test**

```ts
// test/attachmentDownload.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getAttachmentSignedUrl } from '../server/utils/attachmentDownload'

function fakeAdmin(opts: { hasAccess: boolean }) {
  const attSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'att-1',
      storage_path: 'mb-1/101/file.txt',
      filename: 'file.txt',
      message_id: 'msg-1',
      messages: { mailbox_id: 'mb-1' }
    },
    error: null
  })
  const attEq = vi.fn(() => ({ single: attSingle }))
  const attSelect = vi.fn(() => ({ eq: attEq }))

  const accessMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.hasAccess ? { mailbox_id: 'mb-1' } : null,
    error: null
  })
  const accessEq2 = vi.fn(() => ({ maybeSingle: accessMaybeSingle }))
  const accessEq1 = vi.fn(() => ({ eq: accessEq2 }))
  const accessSelect = vi.fn(() => ({ eq: accessEq1 }))

  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/file.txt' }, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'attachments') return { select: attSelect }
    if (table === 'mailbox_access') return { select: accessSelect }
    throw new Error(`unexpected table ${table}`)
  })

  return { from, storage: { from: vi.fn(() => ({ createSignedUrl })) } } as any
}

describe('getAttachmentSignedUrl', () => {
  it('returns a signed URL when the user has access to the owning mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: true })
    const result = await getAttachmentSignedUrl(admin, 'user-1', 'att-1')
    expect(result).toEqual({ url: 'https://signed.example/file.txt', filename: 'file.txt' })
  })

  it('rejects when the user has no access to the owning mailbox', async () => {
    const admin = fakeAdmin({ hasAccess: false })
    await expect(getAttachmentSignedUrl(admin, 'user-1', 'att-1')).rejects.toMatchObject({ statusCode: 403 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/attachmentDownload.test.ts`
Expected: FAIL — `server/utils/attachmentDownload.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// server/utils/attachmentDownload.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMailboxAccess } from './mailboxAccess'

export async function getAttachmentSignedUrl(
  admin: SupabaseClient,
  userId: string,
  attachmentId: string
): Promise<{ url: string; filename: string | null }> {
  const { data: attachment, error } = await admin
    .from('attachments')
    .select('id, storage_path, filename, message_id, messages!inner(mailbox_id)')
    .eq('id', attachmentId)
    .single()

  if (error || !attachment) {
    const err = new Error('Attachment not found') as Error & { statusCode: number }
    err.statusCode = 404
    throw err
  }

  const mailboxId = (attachment as any).messages.mailbox_id
  await assertMailboxAccess(admin, userId, mailboxId)

  const { data: signed, error: signErr } = await admin
    .storage
    .from('attachments')
    .createSignedUrl((attachment as any).storage_path, 60)

  if (signErr || !signed) {
    const err = new Error(signErr?.message || 'Could not sign URL') as Error & { statusCode: number }
    err.statusCode = 500
    throw err
  }

  return { url: signed.signedUrl, filename: (attachment as any).filename }
}
```

```ts
// server/api/attachments/[id]/download.get.ts
import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../../utils/supabaseAdmin'
import { getAttachmentSignedUrl } from '../../../utils/attachmentDownload'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const attachmentId = getRouterParam(event, 'id')
  if (!attachmentId) throw createError({ statusCode: 400, statusMessage: 'Attachment id is required' })

  const { url } = await getAttachmentSignedUrl(getSupabaseAdmin(), user.id, attachmentId)
  return sendRedirect(event, url, 302)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/attachmentDownload.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/attachmentDownload.ts "server/api/attachments/[id]/download.get.ts" test/attachmentDownload.test.ts
git commit -m "feat: add signed-URL attachment download endpoint"
```

---

### Task 10: Auth pages (`login.vue`, `confirm.vue`)

**Files:**
- Create: `app/pages/login.vue`
- Create: `app/pages/confirm.vue`
- Test: `test/login.page.test.ts`

**Interfaces:**
- Consumes: `useSupabaseClient()` (from `@nuxtjs/supabase`, configured in Task 1), `navigateTo()` (Nuxt built-in).
- Produces: the `/login` and `/confirm` routes that `redirectOptions` (Task 1) points to.

- [ ] **Step 1: Write the failing test**

```ts
// test/login.page.test.ts
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import LoginPage from '../app/pages/login.vue'

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { signInWithPassword, navigateToMock } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  navigateToMock: vi.fn()
}))

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ auth: { signInWithPassword } })
})
mockNuxtImport('navigateTo', () => navigateToMock)

describe('login page', () => {
  it('signs in with the entered email/password and redirects home on success', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    const wrapper = await mountSuspended(LoginPage)

    await wrapper.find('input[type="email"]').setValue('user@example.com')
    await wrapper.find('input[type="password"]').setValue('secret123')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret123' })
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })

  it('shows the error message and does not redirect on failure', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    navigateToMock.mockClear()
    const wrapper = await mountSuspended(LoginPage)

    await wrapper.find('input[type="email"]').setValue('user@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.text()).toContain('Invalid login credentials')
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/login.page.test.ts`
Expected: FAIL — `app/pages/login.vue` does not exist yet.

- [ ] **Step 3: Write the implementation**

```vue
<!-- app/pages/login.vue -->
<script setup lang="ts">
const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)

async function handleLogin() {
  loading.value = true
  errorMessage.value = ''
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value
  })
  loading.value = false
  if (error) {
    errorMessage.value = error.message
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <main class="login-page">
    <h1>Sign in to the mail client</h1>
    <form @submit.prevent="handleLogin">
      <label>
        Email
        <input v-model="email" type="email" required autocomplete="email">
      </label>
      <label>
        Password
        <input v-model="password" type="password" required autocomplete="current-password">
      </label>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? 'Signing in...' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login-page { max-width: 360px; margin: 4rem auto; display: flex; flex-direction: column; gap: 1rem; }
form { display: flex; flex-direction: column; gap: 0.75rem; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
input { padding: 0.5rem; font-size: 1rem; }
button { padding: 0.6rem; font-size: 1rem; cursor: pointer; }
.error { color: #c0392b; font-size: 0.9rem; }
</style>
```

```vue
<!-- app/pages/confirm.vue -->
<script setup lang="ts">
onMounted(async () => {
  await navigateTo('/')
})
</script>

<template>
  <main class="confirm-page">
    <p>Confirming your sign-in...</p>
  </main>
</template>

<style scoped>
.confirm-page { max-width: 360px; margin: 4rem auto; text-align: center; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/login.page.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/pages/login.vue app/pages/confirm.vue test/login.page.test.ts
git commit -m "feat: add login and auth-callback pages"
```

---

### Task 11: Realtime composable (`useMailRealtime.ts`)

**Files:**
- Create: `app/composables/useMailRealtime.ts`
- Test: `test/useMailRealtime.test.ts`

**Interfaces:**
- Consumes: `useSupabaseClient()`.
- Produces: `MailMessage` type, `useMailRealtime(messages: Ref<MailMessage[]>): { channel }` — used by Task 12 (`index.vue`).

- [ ] **Step 1: Write the failing test**

```ts
// test/useMailRealtime.test.ts
import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

let capturedCallback: ((payload: { new: any }) => void) | undefined

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { channel, on, removeChannel } = vi.hoisted(() => {
  const subscribe = vi.fn().mockReturnValue('channel-ref')
  const on = vi.fn((_event: string, _filter: unknown, cb: (payload: { new: any }) => void) => {
    capturedCallback = cb
    return { subscribe }
  })
  return {
    channel: vi.fn(() => ({ on })),
    on,
    removeChannel: vi.fn()
  }
})

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ channel, removeChannel })
})

describe('useMailRealtime', () => {
  it('prepends newly inserted messages to the list', async () => {
    const { useMailRealtime } = await import('../app/composables/useMailRealtime')
    const messages = ref<any[]>([{ id: 'existing' }])
    const scope = effectScope()

    scope.run(() => useMailRealtime(messages))

    expect(channel).toHaveBeenCalledWith('inbox-updates')
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      expect.any(Function)
    )

    capturedCallback?.({ new: { id: 'new-message' } })
    expect(messages.value.map((m) => m.id)).toEqual(['new-message', 'existing'])

    scope.stop()
    expect(removeChannel).toHaveBeenCalledWith('channel-ref')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/useMailRealtime.test.ts`
Expected: FAIL — `app/composables/useMailRealtime.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// app/composables/useMailRealtime.ts
import { onScopeDispose, type Ref } from 'vue'

export interface MailMessage {
  id: string
  mailbox_id: string
  subject: string | null
  from_addr: string | null
  received_at: string | null
  is_read: boolean
}

export function useMailRealtime(messages: Ref<MailMessage[]>) {
  const supabase = useSupabaseClient()

  const channel = supabase
    .channel('inbox-updates')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload: { new: MailMessage }) => {
        messages.value = [payload.new, ...messages.value]
      }
    )
    .subscribe()

  onScopeDispose(() => {
    supabase.removeChannel(channel)
  })

  return { channel }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/useMailRealtime.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add app/composables/useMailRealtime.ts test/useMailRealtime.test.ts
git commit -m "feat: add Supabase Realtime composable for live inbox updates"
```

---

### Task 12: Inbox page (`index.vue`)

**Files:**
- Modify: `app/pages/index.vue` (replaces the Task 1 placeholder)
- Test: `test/index.page.test.ts`

**Interfaces:**
- Consumes: `useMailRealtime`, `MailMessage` (Task 11); `useSupabaseClient()`.
- Produces: the `/` route, linking to `/mail/[id]` (Task 13).

- [ ] **Step 1: Write the failing test**

```ts
// test/index.page.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtData } from '#app'
import IndexPage from '../app/pages/index.vue'

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { order, limit, select, from } = vi.hoisted(() => ({
  order: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
  from: vi.fn()
}))

mockNuxtImport('useSupabaseClient', () => {
  return () => ({ from })
})
mockNuxtImport('useMailRealtime', () => vi.fn())

describe('index page (inbox)', () => {
  // `@nuxt/test-utils`'s `mountSuspended` reuses one Nuxt app instance (and
  // therefore one `useAsyncData` static-data cache) across every test in
  // this file, so without clearing it the second mount silently reuses the
  // first mount's cached 'inbox-messages' result regardless of what the
  // mocks return for the second scenario.
  beforeEach(() => {
    clearNuxtData('inbox-messages')
  })

  it('renders the fetched messages', async () => {
    from.mockReturnValue({ select })
    select.mockReturnValue({ order })
    order.mockReturnValue({ limit })
    limit.mockResolvedValue({
      data: [
        { id: 'm1', mailbox_id: 'mb-1', from_addr: 'a@example.com', subject: 'First', received_at: '2026-08-19', is_read: false },
        { id: 'm2', mailbox_id: 'mb-1', from_addr: 'b@example.com', subject: 'Second', received_at: '2026-08-18', is_read: true }
      ],
      error: null
    })

    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('Second')
    expect(wrapper.findAll('a[href="/mail/m1"]').length).toBe(1)
  })

  it('shows an empty state when there are no messages', async () => {
    from.mockReturnValue({ select })
    select.mockReturnValue({ order })
    order.mockReturnValue({ limit })
    limit.mockResolvedValue({ data: [], error: null })

    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.text()).toContain('Your inbox is empty')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.page.test.ts`
Expected: FAIL — placeholder `index.vue` has none of this markup/logic yet.

- [ ] **Step 3: Write the implementation**

```vue
<!-- app/pages/index.vue -->
<script setup lang="ts">
import type { MailMessage } from '~/composables/useMailRealtime'

const supabase = useSupabaseClient()
const messages = ref<MailMessage[]>([])
const loading = ref(true)

const { data } = await useAsyncData('inbox-messages', async () => {
  const { data, error } = await supabase
    .from('messages')
    .select('id, mailbox_id, subject, from_addr, received_at, is_read')
    .order('received_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data ?? []
})
messages.value = data.value ?? []
loading.value = false

useMailRealtime(messages)
</script>

<template>
  <main class="inbox">
    <h1>Inbox</h1>
    <p v-if="loading">Loading...</p>
    <ul v-else class="message-list">
      <li v-for="message in messages" :key="message.id">
        <NuxtLink :to="`/mail/${message.id}`" :class="{ unread: !message.is_read }">
          <span class="from">{{ message.from_addr || '(unknown sender)' }}</span>
          <span class="subject">{{ message.subject || '(no subject)' }}</span>
        </NuxtLink>
      </li>
    </ul>
    <p v-if="!loading && messages.length === 0">Your inbox is empty.</p>
  </main>
</template>

<style scoped>
.inbox { max-width: 720px; margin: 2rem auto; }
.message-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.message-list a { display: flex; justify-content: space-between; gap: 1rem; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; text-decoration: none; color: inherit; }
.message-list a.unread { font-weight: 600; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index.page.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/pages/index.vue test/index.page.test.ts
git commit -m "feat: implement inbox page with realtime updates"
```

---

### Task 13: Message detail + reply page (`mail/[id].vue`)

**Files:**
- Create: `app/pages/mail/[id].vue`
- Test: `test/mail-id.page.test.ts`

**Interfaces:**
- Consumes: `useSupabaseClient()`, `useRoute()`, `$fetch('/api/mail/send')` (Task 7), `/api/attachments/[id]/download` links (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// test/mail-id.page.test.ts
import { describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import MailDetailPage from '../app/pages/mail/[id].vue'

// mockNuxtImport rewrites into a hoisted vi.mock() call, so the values its
// factory closes over must be declared via vi.hoisted() — a plain top-level
// const here throws "Cannot access '...' before initialization" (TDZ).
const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn().mockResolvedValue({ ok: true })
}))

mockNuxtImport('useRoute', () => () => ({ params: { id: 'm1' } }))
mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useSupabaseClient', () => {
  return () => ({
    from: vi.fn((table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: {
                  id: 'm1',
                  mailbox_id: 'mb-1',
                  from_addr: 'sender@example.com',
                  to_addrs: ['inbox1@example.com'],
                  subject: 'Hello there',
                  body_html: null,
                  body_text: 'Plain body',
                  received_at: '2026-08-19'
                },
                error: null
              })
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) })
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) })
        }
      }
      if (table === 'attachments') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
  })
})

describe('mail detail page', () => {
  it('renders the message subject and body', async () => {
    const wrapper = await mountSuspended(MailDetailPage)
    expect(wrapper.text()).toContain('Hello there')
    expect(wrapper.text()).toContain('Plain body')
  })

  it('sends a reply via /api/mail/send', async () => {
    const wrapper = await mountSuspended(MailDetailPage)
    await wrapper.find('button').trigger('click') // Reply
    await wrapper.find('textarea').setValue('My reply')
    await wrapper.find('form').trigger('submit.prevent')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ mailboxId: 'mb-1', text: 'My reply' })
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mail-id.page.test.ts`
Expected: FAIL — `app/pages/mail/[id].vue` does not exist yet.

- [ ] **Step 3: Write the implementation**

```vue
<!-- app/pages/mail/[id].vue -->
<script setup lang="ts">
import sanitizeHtml from 'sanitize-html'

const route = useRoute()
const supabase = useSupabaseClient()
const messageId = route.params.id as string

const { data: message } = await useAsyncData(`message-${messageId}`, async () => {
  const { data, error } = await supabase
    .from('messages')
    .select('id, mailbox_id, from_addr, to_addrs, subject, body_html, body_text, received_at')
    .eq('id', messageId)
    .single()
  if (error) throw error
  return data
})

const { data: attachments } = await useAsyncData(`attachments-${messageId}`, async () => {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, filename, content_type, size_bytes')
    .eq('message_id', messageId)
  if (error) throw error
  return data ?? []
})

// Fire-and-forget: this is a side effect of viewing the message, not
// something the initial render should block on. Errors are swallowed —
// failing to mark a message read shouldn't surface as a page error.
supabase.from('messages').update({ is_read: true }).eq('id', messageId).then(() => {}, () => {})

// Email body_html is fully attacker-controlled (anyone who can send mail to
// the mailbox can inject markup) and gets rendered via v-html below, so it
// must be sanitized first — otherwise this is a stored-XSS vector.
const sanitizedBodyHtml = computed(() => {
  if (!message.value?.body_html) return null
  return sanitizeHtml(message.value.body_html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt']
    }
  })
})

const replyTo = ref('')
const replySubject = ref('')
const replyBody = ref('')
const replying = ref(false)
const sending = ref(false)
const sendError = ref('')
const sent = ref(false)

function startReply() {
  if (!message.value) return
  replyTo.value = message.value.from_addr ?? ''
  replySubject.value = message.value.subject ? `Re: ${message.value.subject}` : 'Re:'
  replying.value = true
}

async function sendReply() {
  if (!message.value) return
  sending.value = true
  sendError.value = ''
  try {
    await $fetch('/api/mail/send', {
      method: 'POST',
      body: {
        mailboxId: message.value.mailbox_id,
        to: replyTo.value,
        subject: replySubject.value,
        text: replyBody.value
      }
    })
    sent.value = true
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage || err?.message || 'Could not send the message'
  } finally {
    sending.value = false
  }
}

function attachmentUrl(attachmentId: string) {
  return `/api/attachments/${attachmentId}/download`
}
</script>

<template>
  <main class="message-view">
    <NuxtLink to="/">&larr; Back to inbox</NuxtLink>
    <template v-if="message">
      <h1>{{ message.subject || '(no subject)' }}</h1>
      <p class="meta">From: {{ message.from_addr }} · {{ message.received_at }}</p>
      <div v-if="sanitizedBodyHtml" v-html="sanitizedBodyHtml" class="body" />
      <pre v-else class="body">{{ message.body_text }}</pre>

      <section v-if="attachments && attachments.length" class="attachments">
        <h2>Attachments</h2>
        <ul>
          <li v-for="att in attachments" :key="att.id">
            <a :href="attachmentUrl(att.id)" target="_blank" rel="noopener">{{ att.filename }}</a>
            <span class="size">({{ att.size_bytes }} bytes)</span>
          </li>
        </ul>
      </section>

      <section class="reply">
        <button v-if="!replying" type="button" @click="startReply">Reply</button>
        <form v-else @submit.prevent="sendReply">
          <label>To <input v-model="replyTo" type="email" required></label>
          <label>Subject <input v-model="replySubject" type="text" required></label>
          <label>Message <textarea v-model="replyBody" rows="6" required /></label>
          <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
          <p v-if="sent" class="success">Sent.</p>
          <button type="submit" :disabled="sending">{{ sending ? 'Sending...' : 'Send' }}</button>
        </form>
      </section>
    </template>
  </main>
</template>

<style scoped>
.message-view { max-width: 720px; margin: 2rem auto; display: flex; flex-direction: column; gap: 1rem; }
.meta { color: #666; font-size: 0.9rem; }
.body { border-top: 1px solid #ddd; padding-top: 1rem; }
.attachments ul { list-style: none; padding: 0; }
.reply form { display: flex; flex-direction: column; gap: 0.5rem; }
.error { color: #c0392b; }
.success { color: #1e7e34; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mail-id.page.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add "app/pages/mail/[id].vue" test/mail-id.page.test.ts
git commit -m "feat: implement message detail page with reply and attachment links"
```

---

### Task 14: Vercel deployment config + README

**Files:**
- Create: `vercel.json`
- Create: `README.md`

**Interfaces:**
- Produces: the cron schedule Vercel needs (spec §5) and a deployment runbook mirroring spec §12.

- [ ] **Step 1: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Mail Client

Multi-user webmail on Nuxt 4, hosted on Vercel, backed by Supabase
(Postgres + Auth + Storage + Realtime). See
[mail-client-vercel-supabase_1.md](mail-client-vercel-supabase_1.md) for the
full architecture spec this project implements.

## Local development

npm install
cp .env.example .env   # fill in the values below
npm run dev

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | client + server | Project URL |
| `SUPABASE_ANON_KEY` | client + server | Public, RLS-restricted |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS — never expose to the browser |
| `MAIL_ENCRYPTION_KEY` | server only | `openssl rand -hex 32` |
| `CRON_SECRET` | server only | Any random string; must match the `Authorization: Bearer` header on `/api/cron/sync` |

## Deploying

1. Create a Supabase project. Run `supabase/migrations/0001_init.sql` in its
   SQL editor (creates tables, RLS policies, and the private `attachments`
   Storage bucket).
2. Generate `MAIL_ENCRYPTION_KEY` (`openssl rand -hex 32`). Encrypt each of
   the 4 mailboxes' IMAP/SMTP passwords with it and insert rows into
   `mailboxes`, then link each to its user via `mailbox_access`.
3. Deploy this repo to Vercel, set all 5 env vars from the table above in
   Project Settings → Environment Variables.
4. `vercel.json`'s cron (`*/5 * * * *`) requires the **Vercel Pro** plan —
   Hobby only allows once-daily cron. See spec §2 for alternatives
   (external cron pinging the endpoint, or a separate IMAP IDLE worker).
5. Verify: call `/api/cron/sync` with `Authorization: Bearer <CRON_SECRET>`
   manually, confirm messages appear in the UI. Then verify
   `/api/mail/send` from the reply form on a message.
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json README.md
git commit -m "docs: add Vercel cron config and deployment README"
```

---

### Task 15: Full test suite + build + typecheck gate

**Files:**
- None created — verification-only task.

**Interfaces:**
- Consumes: everything from Tasks 1–14.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all test files from Tasks 3–13 pass (crypto, supabaseAdmin, cronAuth, mailboxAccess, imap, mailSync, sendMail, listMail, attachmentDownload, login page, useMailRealtime, index page, mail detail page).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. Fix any type errors surfaced (e.g. Supabase generic types on `.select()` chains) before proceeding.

- [ ] **Step 3: Production build**

Run (PowerShell, with dummy env vars since no live Supabase project is connected in this session):
```powershell
$env:SUPABASE_URL = "https://example.supabase.co"; $env:SUPABASE_ANON_KEY = "dummy"; $env:SUPABASE_SERVICE_ROLE_KEY = "dummy"; npm run build
```
Expected: exits 0, Nitro build succeeds, no missing-module errors for `nodemailer`, `imapflow`, or `mailparser`.

- [ ] **Step 4: Commit (only if fixes were needed in Steps 1–3)**

```bash
git add -A
git commit -m "fix: resolve typecheck/build issues found in final verification pass"
```

---

## Self-Review Notes

**Spec coverage:** §1 architecture → Tasks 1, 4, 6, 7. §2 cron limits → Task 14 README. §3 schema/RLS → Task 2. §4 password encryption → Task 3. §5 project structure → File Structure section + Tasks throughout. §6 send → Task 7. §7 IMAP sync → Tasks 5–6 (improved over the spec's draft by actually writing `attachments` rows and setting `folder_id`, both of which the spec's schema requires but its sample code omitted). §8 Realtime → Task 11. §9 auth → Tasks 1, 10. §10 env vars → Task 1, 14. §11 packages → Task 1. §12 deployment order → Task 14 README + Task 2 manual checklist. §13 cost → Task 14 README (implicitly via Pro-plan note); not otherwise actionable in code.

**Gaps intentionally left for deployment time, not code:** creating the actual Supabase project, inserting the 4 real mailbox rows/credentials, and Vercel plan selection — these require live accounts this session doesn't have, and are called out explicitly in Task 2 and Task 14 rather than faked.
