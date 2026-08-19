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
