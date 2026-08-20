// server/utils/mailSync.ts
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildImapConfig, ensureFolderId, type MailboxRow } from './imap'

export interface SyncableMailbox extends MailboxRow {
  imap_password_encrypted: string
  last_uid_seen: number
}

function getRecipientAddresses(to: Awaited<ReturnType<typeof simpleParser>>['to']): string[] {
  const groups = Array.isArray(to) ? to : to ? [to] : []

  return groups.flatMap(group => {
    const addresses = group.value
      ?.map(address => address.address || address.name)
      .filter((address): address is string => Boolean(address)) ?? []

    return addresses.length > 0 ? addresses : group.text ? [group.text] : []
  })
}

function getAttachmentName(filename: string | undefined, index: number): string {
  const fallback = `attachment-${index + 1}`
  const cleaned = (filename || fallback)
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()

  return `${index + 1}-${cleaned || fallback}`
}

async function saveMessage(
  admin: SupabaseClient,
  values: Record<string, unknown>
): Promise<string> {
  const { data: existing, error: selectErr } = await admin
    .from('messages')
    .select('id')
    .eq('mailbox_id', values.mailbox_id)
    .eq('folder_id', values.folder_id)
    .eq('imap_uid', values.imap_uid)
    .limit(1)
  if (selectErr) throw new Error(selectErr.message)

  const existingId = existing?.[0]?.id
  const query = existingId
    ? admin.from('messages').update(values).eq('id', existingId)
    : admin.from('messages').insert(values)
  const { data: saved, error: saveErr } = await query.select('id').single()
  if (saveErr || !saved) throw new Error(saveErr?.message || 'Could not save the message')

  return saved.id
}

async function saveAttachment(
  admin: SupabaseClient,
  values: Record<string, unknown>
): Promise<void> {
  const { data: existing, error: selectErr } = await admin
    .from('attachments')
    .select('id')
    .eq('message_id', values.message_id)
    .eq('storage_path', values.storage_path)
    .limit(1)
  if (selectErr) throw new Error(selectErr.message)

  const existingId = existing?.[0]?.id
  const { error: saveErr } = existingId
    ? await admin.from('attachments').update(values).eq('id', existingId)
    : await admin.from('attachments').insert(values)
  if (saveErr) throw new Error(saveErr.message)
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

      for await (const msg of client.fetch(uidRange, { envelope: true, source: true, uid: true }, { uid: true })) {
        if (msg.uid <= mailbox.last_uid_seen) continue
        // ImapFlow types `source` as possibly undefined even though the
        // fetch query above requested `source: true`; skip defensively
        // rather than pass undefined into simpleParser.
        if (!msg.source) continue
        const parsed = await simpleParser(msg.source)

        const messageId = await saveMessage(admin, {
          mailbox_id: mailbox.id,
          folder_id: folderId,
          imap_uid: msg.uid,
          message_id: parsed.messageId,
          from_addr: parsed.from?.text,
          to_addrs: getRecipientAddresses(parsed.to),
          subject: parsed.subject,
          body_text: parsed.text,
          body_html: parsed.html || null,
          received_at: parsed.date
        })

        for (const [index, att] of (parsed.attachments ?? []).entries()) {
          const filename = getAttachmentName(att.filename, index)
          const path = `${mailbox.id}/${msg.uid}/${filename}`
          const { error: uploadErr } = await admin.storage.from('attachments').upload(path, att.content, {
            contentType: att.contentType,
            upsert: true
          })
          if (uploadErr) throw new Error(uploadErr.message)

          await saveAttachment(admin, {
            message_id: messageId,
            filename: att.filename || filename,
            content_type: att.contentType,
            storage_path: path,
            size_bytes: att.size
          })
        }

        maxUid = Math.max(maxUid, msg.uid)
      }

      if (maxUid > mailbox.last_uid_seen) {
        const { error: updateErr } = await admin
          .from('mailboxes')
          .update({ last_uid_seen: maxUid })
          .eq('id', mailbox.id)
        if (updateErr) throw new Error(updateErr.message)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}
