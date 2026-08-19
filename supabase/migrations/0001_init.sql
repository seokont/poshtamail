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
  size_bytes int,
  constraint attachments_message_storage_key unique (message_id, storage_path)
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
