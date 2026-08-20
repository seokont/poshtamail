import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMailboxAccess } from './mailboxAccess'
import { decrypt } from './crypto'
import { saveSentCopy, type SentCopyMailbox } from './sentCopy'

export interface SendMailParams {
  mailboxId: string
  to: string
  subject: string
  text?: string
  html?: string
}

export type TransporterFactory = typeof nodemailer.createTransport
export type SentCopySaver = typeof saveSentCopy

export async function sendMailForUser(
  admin: SupabaseClient,
  userId: string,
  params: SendMailParams,
  createTransport: TransporterFactory = nodemailer.createTransport,
  saveCopy: SentCopySaver = saveSentCopy
): Promise<{ ok: true }> {
  await assertMailboxAccess(admin, userId, params.mailboxId)

  const { data: mailbox, error } = await admin
    .from('mailboxes')
    .select('id, email, imap_host, imap_port, smtp_host, smtp_port, imap_password_encrypted, smtp_password_encrypted')
    .eq('id', params.mailboxId)
    .single()
  if (error || !mailbox) {
    const err = new Error('Mailbox not found') as Error & { statusCode: number }
    err.statusCode = 404
    throw err
  }

  const transporter = createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_port === 465,
    auth: {
      user: mailbox.email,
      pass: decrypt(mailbox.smtp_password_encrypted)
    }
  })

  const sent = await transporter.sendMail({
    from: mailbox.email,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html
  })

  try {
    await saveCopy(admin, mailbox as SentCopyMailbox, {
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      messageId: sent.messageId
    })
  } catch (cause) {
    console.error('Message sent, but its Sent copy could not be saved', cause)
  }

  return { ok: true }
}
