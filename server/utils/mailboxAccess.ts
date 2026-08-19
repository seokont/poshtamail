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
