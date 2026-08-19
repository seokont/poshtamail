# Nuxt Mail Client: Vercel + Supabase (Detailed Implementation)

This document describes a production-oriented architecture for a multi-user
mail client built with Nuxt. Vercel hosts the application, while Supabase
provides persistent Postgres storage, authentication, private file storage,
and Realtime updates. The default setup assumes four external mailboxes and
four users, with one mailbox assigned to each user. The access model can also
support shared mailboxes.

---

## 1. Architecture

```text
┌──────────────────────────┐
│ Nuxt 4 / Nitro on Vercel │
│                          │
│ - pages and UI           │
│ - server API routes      │
│ - SMTP delivery          │
│ - scheduled IMAP sync    │
└────────────┬─────────────┘
             │ supabase-js
             │ service role on the server
             │ anon key + RLS in the browser
             ▼
┌──────────────────────────┐
│ Supabase                 │
│ - Postgres               │
│ - Auth                   │
│ - private Storage        │
│ - Realtime               │
└────────────┬─────────────┘
             ▲
             │ IMAP receive / SMTP send
┌────────────┴─────────────┐
│ 4 external mailboxes     │
└──────────────────────────┘
```

Supabase solves the persistence problem of serverless hosting: data is stored
in managed Postgres instead of the ephemeral Vercel filesystem.

---

## 2. Mail Sync and Vercel Cron Limits

This is the main platform constraint:

| Vercel plan | Minimum cron interval |      Scheduling precision |
| ----------- | --------------------: | ------------------------: |
| Hobby       |          Once per day | Within the scheduled hour |
| Pro         |       Once per minute |              Minute-level |

A Hobby deployment cannot include a Vercel cron schedule that runs more than
once per day. For useful mail delivery, choose one of these approaches:

- **Option A, Vercel Pro:** call `/api/cron/sync` every one to five minutes.
- **Option B, near real time:** run a separate Node worker on a VPS, Railway,
  or Fly.io and keep IMAP IDLE connections open. The worker writes new mail to
  Supabase with the service role key.
- **Option C, Vercel Hobby:** use an external scheduler such as cron-job.org
  or EasyCron to call the protected sync endpoint every one to five minutes.

For a team production tool, the Pro plan is the simplest operational choice.
The included `vercel.json` uses a five-minute schedule and therefore expects
Vercel Pro or an external scheduler.

---

## 3. Supabase Database Schema

The canonical schema is in
`supabase/migrations/0001_init.sql`. It contains:

- `profiles` for user metadata;
- `mailboxes` for IMAP/SMTP settings and encrypted credentials;
- `mailbox_access` for the user-to-mailbox access mapping;
- `folders` for mailbox folders;
- `messages` for synchronized mail;
- `attachments` for private Storage metadata.

Core table relationships:

```sql
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
```

### Row Level Security

RLS prevents users from reading mailboxes they do not own, even when they call
Supabase directly from the browser:

```sql
alter table public.mailboxes enable row level security;
alter table public.mailbox_access enable row level security;
alter table public.folders enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;

create policy user_sees_own_messages
  on public.messages for select
  using (
    exists (
      select 1
      from public.mailbox_access ma
      where ma.mailbox_id = messages.mailbox_id
        and ma.user_id = auth.uid()
    )
  );
```

The browser uses the anonymous key and remains subject to RLS. Server-only
sync and send operations use the service role key, which bypasses RLS. That
key must never be exposed through a public runtime variable or client bundle.

The private `attachments` bucket uses a Storage policy based on the mailbox
ID in each object path. Migration
`0002_idempotent_attachments.sql` removes duplicate metadata from older
deployments and adds a unique `message_id, storage_path` constraint.

---

## 4. Protecting IMAP and SMTP Passwords

Mailbox passwords are sensitive credentials and must not be stored as plain
text.

1. Generate a 32-byte key with `openssl rand -hex 32`.
2. Store it only as the server-side `MAIL_ENCRYPTION_KEY` environment
   variable.
3. Encrypt mailbox passwords with AES-256-GCM before inserting them into
   `imap_password_encrypted` and `smtp_password_encrypted`.
4. Decrypt them only immediately before an IMAP or SMTP connection. Never log
   the decrypted value.

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey() {
  const hex = process.env.MAIL_ENCRYPTION_KEY;
  if (!hex) throw new Error("MAIL_ENCRYPTION_KEY must be set");

  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("MAIL_ENCRYPTION_KEY must be 32 bytes");
  }
  return key;
}

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload: string) {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
```

Gmail, Outlook, and similar providers generally require an app password or
OAuth2 instead of the normal account password. Traditional credentials may
still be appropriate for a managed corporate IMAP/SMTP server.

---

## 5. Nuxt Project Structure

```text
nuxt.config.ts
vercel.json
app/
  assets/css/main.css
  components/ComposeModal.vue
  composables/
    useMailboxes.ts
    useMailRealtime.ts
  layouts/default.vue
  pages/
    login.vue
    confirm.vue
    index.vue
    mail/[id].vue
server/
  api/
    attachments/[id]/download.get.ts
    cron/sync.ts
    mail/list.get.ts
    mail/send.post.ts
  utils/
    attachmentDownload.ts
    cronAuth.ts
    crypto.ts
    imap.ts
    listMail.ts
    mailboxAccess.ts
    mailSync.ts
    sendMail.ts
    supabaseAdmin.ts
supabase/migrations/
  0001_init.sql
  0002_idempotent_attachments.sql
```

The cron configuration is:

```json
{
  "crons": [{ "path": "/api/cron/sync", "schedule": "0 8 * * *" }]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is
configured. The endpoint verifies this header before opening any IMAP
connection.

---

## 6. Sending Mail over SMTP

`POST /api/mail/send` performs these steps:

1. Resolve the authenticated Supabase user.
2. Validate `mailboxId`, `to`, `subject`, and the message body.
3. Confirm access through `mailbox_access`.
4. Load the selected mailbox with the service role client.
5. Decrypt the SMTP password.
6. Send the message through Nodemailer.

```ts
const transporter = nodemailer.createTransport({
  host: mailbox.smtp_host,
  port: mailbox.smtp_port,
  secure: mailbox.smtp_port === 465,
  auth: {
    user: mailbox.email,
    pass: decrypt(mailbox.smtp_password_encrypted),
  },
});

await transporter.sendMail({
  from: mailbox.email,
  to,
  subject,
  text,
  html,
});
```

The endpoint limits field sizes and requires a non-empty text or HTML body.
The service role key and decrypted password remain server-only.

---

## 7. Receiving Mail with Incremental IMAP Sync

The project uses `imapflow` and `mailparser`. Each mailbox stores
`last_uid_seen`, so a sync fetches only messages with a greater UID.

```ts
const client = new ImapFlow({
  host: mailbox.imap_host,
  port: mailbox.imap_port,
  secure: true,
  auth: {
    user: mailbox.email,
    pass: decrypt(mailbox.imap_password_encrypted),
  },
  logger: false,
});

await client.connect();
const lock = await client.getMailboxLock("INBOX");

try {
  const range = `${mailbox.last_uid_seen + 1}:*`;

  for await (const item of client.fetch(
    range,
    { envelope: true, source: true, uid: true },
    { uid: true },
  )) {
    if (!item.source || item.uid <= mailbox.last_uid_seen) continue;
    const parsed = await simpleParser(item.source);
    // Upsert the message, then upload and upsert its attachments.
  }
} finally {
  lock.release();
  await client.logout();
}
```

Every synchronized message is upserted by mailbox, folder, and IMAP UID.
Attachment filenames are normalized before being used in Storage paths.
Metadata is upserted by message and storage path, so retrying a partially
failed sync does not create duplicates.

The mailbox UID is advanced only after message and attachment writes succeed.
Errors from the final UID update are propagated instead of being silently
ignored.

Serverless execution time is limited. Process large initial imports in
batches, or split mailboxes across independent scheduled calls if one sync can
approach the platform timeout.

---

## 8. Realtime Inbox Updates

Supabase Realtime broadcasts inserted `messages` rows to authenticated
browser sessions. RLS still applies to these events.

```ts
const channel = supabase
  .channel("inbox-updates")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "messages" },
    (payload) => {
      if (payload.new.mailbox_id !== selectedMailboxId.value) return;
      messages.value = [payload.new, ...messages.value];
    },
  )
  .subscribe();

onScopeDispose(() => {
  supabase.removeChannel(channel);
});
```

The implementation filters events by the currently selected mailbox and
deduplicates message IDs before prepending them to the list.

---

## 9. User Authentication

The `@nuxtjs/supabase` module provides browser composables, server user
resolution, and redirect middleware.

```ts
export default defineNuxtConfig({
  modules: ["@nuxtjs/supabase"],
  supabase: {
    redirectOptions: {
      login: "/login",
      callback: "/confirm",
      exclude: ["/login", "/confirm"],
    },
  },
});
```

Public sign-up should be disabled for a small team installation. Create users
through the Supabase Dashboard or Admin API, then assign each user to one or
more rows in `mailbox_access`.

The UI includes password sign-in, protected application routes, mailbox
switching, sign-out, and responsive desktop and mobile navigation.

---

## 10. Environment Variables

Configure these values in Vercel Project Settings:

```dotenv
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAIL_ENCRYPTION_KEY=
CRON_SECRET=
```

| Variable                    | Exposure          | Purpose                                      |
| --------------------------- | ----------------- | -------------------------------------------- |
| `SUPABASE_URL`              | Client and server | Supabase project URL                         |
| `SUPABASE_ANON_KEY`         | Client and server | Public key restricted by RLS                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only       | Administrative database and Storage access   |
| `MAIL_ENCRYPTION_KEY`       | Server only       | 32-byte AES key encoded as 64 hex characters |
| `CRON_SECRET`               | Server only       | Protects the IMAP sync endpoint              |

Never prefix the service role or encryption key with `NUXT_PUBLIC_`.

---

## 11. Packages

```bash
npm install
```

Important runtime packages include:

- `@nuxtjs/supabase` and `@supabase/supabase-js`;
- `imapflow` and `mailparser`;
- `nodemailer`;
- `sanitize-html`;
- `@lucide/vue`.

The lockfile includes a security override for `deepmerge-ts 8.0.1`, required
by the current `mailparser` dependency tree. Keep the automated tests and
`npm audit --omit=dev` in the dependency upgrade workflow.

---

## 12. Deployment Procedure

1. Create a Supabase project.
2. Run every SQL file in `supabase/migrations` in numeric order.
3. Confirm that the private `attachments` bucket and its RLS policy exist.
4. Generate `MAIL_ENCRYPTION_KEY`.
5. Encrypt and insert the four mailbox credentials.
6. Create users and populate `mailbox_access`.
7. Deploy the Nuxt project to Vercel.
8. Add all five environment variables.
9. Use Vercel Pro for the bundled five-minute cron, or configure an external
   scheduler to call `/api/cron/sync`.
10. Call the sync endpoint manually with the correct bearer token.
11. Confirm that new messages appear in the selected inbox through Realtime.
12. Test a new message and a reply through `/api/mail/send`.
13. Test a private attachment download through its signed URL endpoint.

Before deployment, run:

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

---

## 13. Approximate Operating Cost

- **Vercel:** the Pro plan is normally required for a cron schedule more
  frequent than once per day. An external scheduler can be used with Hobby.
- **Supabase:** the free tier is often sufficient for a small initial mail
  archive. Upgrade when database, Storage, egress, or availability
  requirements exceed the free allowance.

Pricing and limits change over time. Verify them before deployment in the
official documentation:

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Nuxt quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nuxtjs)
