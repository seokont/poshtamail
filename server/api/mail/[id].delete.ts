import { serverSupabaseUser } from '#supabase/server'
import { getSupabaseAdmin } from '../../utils/supabaseAdmin'
import { trashMailForUser } from '../../utils/trashMail'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch((cause: any) => {
    if (cause?.statusMessage === 'Auth session missing!' || cause?.message === 'Auth session missing!') {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    throw cause
  })
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const messageId = getRouterParam(event, 'id')
  if (!messageId) throw createError({ statusCode: 400, statusMessage: 'Message id is required' })

  try {
    return await trashMailForUser(getSupabaseAdmin(), user.id, messageId)
  } catch (cause: any) {
    if (cause?.statusCode) throw cause
    console.error('Could not move message to Trash', cause)
    throw createError({ statusCode: 500, statusMessage: 'Could not move the message to Trash' })
  }
})
