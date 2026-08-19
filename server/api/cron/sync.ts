import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { assertCronAuthorized } from '../../utils/cronAuth'
import { syncAllMailboxes } from '../../utils/mailSync'
import { decrypt } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  assertCronAuthorized(getHeader(event, 'authorization'), process.env.CRON_SECRET)
  return await syncAllMailboxes(getSupabaseAdmin(), decrypt)
})
