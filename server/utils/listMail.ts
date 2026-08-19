import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMailboxAccess } from './mailboxAccess'

export interface ListMessagesParams {
  mailboxId: string
  limit?: number
  offset?: number
}

export async function listMessages(admin: SupabaseClient, userId: string, params: ListMessagesParams) {
  await assertMailboxAccess(admin, userId, params.mailboxId)

  const limit = Number.isFinite(params.limit)
    ? Math.min(100, Math.max(1, Math.trunc(params.limit!)))
    : 50
  const offset = Number.isFinite(params.offset)
    ? Math.max(0, Math.trunc(params.offset!))
    : 0

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
