import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { sendMailForUser } from '../../utils/sendMail'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody<Record<string, unknown>>(event)
  const mailboxId = typeof body?.mailboxId === 'string' ? body.mailboxId.trim() : ''
  const to = typeof body?.to === 'string' ? body.to.trim() : ''
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : undefined
  const html = typeof body?.html === 'string' ? body.html : undefined

  if (!mailboxId || !to || !subject) {
    throw createError({ statusCode: 400, statusMessage: 'mailboxId, to and subject are required' })
  }
  if (to.length > 2_000 || subject.length > 998 || (text?.length ?? 0) > 2_000_000 || (html?.length ?? 0) > 2_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Message fields are too long' })
  }
  if (!text?.trim() && !html?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Message body is required' })
  }

 //lllllllll

  return await sendMailForUser(getSupabaseAdmin(), user.id, {
    mailboxId,
    to,
    subject,
    text,
    html
  })
})
