-- Make attachment metadata idempotent for projects created before the
-- uniqueness constraint was added to 0001_init.sql.
with ranked as (
  select id,
    row_number() over (partition by message_id, storage_path order by id) as row_number
  from public.attachments
)
delete from public.attachments
where id in (select id from ranked where row_number > 1);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attachments_message_storage_key'
      and conrelid = 'public.attachments'::regclass
  ) then
    alter table public.attachments
      add constraint attachments_message_storage_key unique (message_id, storage_path);
  end if;
end
$$;
