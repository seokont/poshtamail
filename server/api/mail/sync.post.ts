import { serverSupabaseUser } from '#supabase/server'
import { decrypt } from '../../utils/crypto'
import { assertMailboxAccess } from '../../utils/mailboxAccess'
import { syncMailbox, type SyncableMailbox } from '../../utils/mailSync'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody<Record<string, unknown>>(event)
  const mailboxId = typeof body?.mailboxId === 'string' ? body.mailboxId.trim() : ''
  if (!mailboxId) throw createError({ statusCode: 400, statusMessage: 'mailboxId is required' })

  const admin = getSupabaseAdmin()
  await assertMailboxAccess(admin, user.id, mailboxId)

  const { data: mailbox, error } = await admin
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single()
  if (error || !mailbox) {
    throw createError({ statusCode: 404, statusMessage: 'Mailbox not found' })
  }

  try {
    await syncMailbox(admin, mailbox as SyncableMailbox, decrypt)
    return { ok: true }
  } catch (cause: any) {
    console.error(`[sync:mail] failed for mailbox ${mailboxId}:`, cause)
    throw createError({
      statusCode: 502,
      statusMessage: cause?.message || 'Could not sync the mailbox'
    })
  }
})
