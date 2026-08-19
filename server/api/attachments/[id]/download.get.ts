import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../../utils/supabaseAdmin'
import { getAttachmentSignedUrl } from '../../../utils/attachmentDownload'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const attachmentId = getRouterParam(event, 'id')
  if (!attachmentId) throw createError({ statusCode: 400, statusMessage: 'Attachment id is required' })

  const { url } = await getAttachmentSignedUrl(getSupabaseAdmin(), user.id, attachmentId)
  return sendRedirect(event, url, 302)
})
