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
