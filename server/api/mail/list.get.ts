import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { listMessages } from '../../utils/listMail'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const query = getQuery(event)
  const mailboxId = String(query.mailboxId || '')
  if (!mailboxId) throw createError({ statusCode: 400, statusMessage: 'mailboxId is required' })

  const limit = query.limit === undefined ? undefined : Number(query.limit)
  const offset = query.offset === undefined ? undefined : Number(query.offset)
  if ((limit !== undefined && !Number.isFinite(limit)) || (offset !== undefined && !Number.isFinite(offset))) {
    throw createError({ statusCode: 400, statusMessage: 'limit and offset must be numbers' })
  }

  return await listMessages(getSupabaseAdmin(), user.id, {
    mailboxId,
    limit,
    offset
  })
})
