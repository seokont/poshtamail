import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { assertCronAuthorized } from '../../utils/cronAuth'
import { syncAllMailboxes } from '../../utils/mailSync'
import { decrypt } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  assertCronAuthorized(getHeader(event, 'authorization'), process.env.CRON_SECRET)
  try {
    return await syncAllMailboxes(getSupabaseAdmin(), decrypt)
  } catch (cause: any) {
    console.error('[sync:cron] failed:', cause)
    throw createError({
      statusCode: 502,
      statusMessage: cause?.message || 'Could not sync mailboxes'
    })
  }
})
