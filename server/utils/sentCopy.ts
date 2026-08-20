import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto'
import { buildImapConfig, ensureFolderId, type MailboxRow } from './imap'
import { saveMessage } from './mailSync'

export interface SentCopyMailbox extends MailboxRow {
  imap_password_encrypted: string
}

export interface SentCopyParams {
  to: string
  subject: string
  text?: string
  html?: string
  messageId?: string
}

interface SentImapClient {
  connect(): Promise<unknown>
  list(): Promise<Array<{ path: string; delimiter: string; specialUse?: string }>>
  mailboxCreate(path: string): Promise<{ path: string }>
  append(
    path: string,
    content: Buffer,
    flags: string[],
    idate: Date
  ): Promise<{ uid?: number } | false>
  logout(): Promise<unknown>
}

export type SentImapClientFactory = (
  config: ReturnType<typeof buildImapConfig>
) => SentImapClient

export type RawTransportFactory = (options: {
  streamTransport: true
  buffer: true
  newline: 'unix'
}) => {
  sendMail(options: Record<string, unknown>): Promise<{ message?: Buffer | string }>
}

function fallbackSentPath(folders: Array<{ path: string; delimiter: string; specialUse?: string }>): string {
  const inbox = folders.find(folder => folder.specialUse === '\\Inbox' || folder.path.toUpperCase() === 'INBOX')
  return inbox ? `${inbox.path}${inbox.delimiter}Sent` : 'Sent'
}

export async function saveSentCopy(
  admin: SupabaseClient,
  mailbox: SentCopyMailbox,
  params: SentCopyParams,
  createRawTransport: RawTransportFactory = options => nodemailer.createTransport(options) as any,
  createClient: SentImapClientFactory = config => new ImapFlow(config)
): Promise<{ saved: boolean }> {
  const sentAt = new Date()
  const rawTransport = createRawTransport({ streamTransport: true, buffer: true, newline: 'unix' })
  const compiled = await rawTransport.sendMail({
    from: mailbox.email,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    messageId: params.messageId,
    date: sentAt
  })
  if (!compiled.message) throw new Error('Could not compile the sent message')
  const rawMessage = Buffer.isBuffer(compiled.message)
    ? compiled.message
    : Buffer.from(compiled.message)

  const client = createClient(buildImapConfig(mailbox, decrypt(mailbox.imap_password_encrypted)))
  await client.connect()

  let appended: { uid?: number } | false
  try {
    const folders = await client.list()
    const existingSent = folders.find(folder => folder.specialUse === '\\Sent')
    let sentPath = existingSent?.path || fallbackSentPath(folders)
    if (!existingSent) sentPath = (await client.mailboxCreate(sentPath)).path
    appended = await client.append(sentPath, rawMessage, ['\\Seen'], sentAt)
  } finally {
    await client.logout()
  }

  if (!appended || !appended.uid) return { saved: false }
  const appendedUid = appended.uid

  const folderId = await ensureFolderId(admin, mailbox.id, 'SENT')
  await saveMessage(admin, {
    mailbox_id: mailbox.id,
    folder_id: folderId,
    imap_uid: appendedUid,
    message_id: params.messageId,
    from_addr: mailbox.email,
    to_addrs: [params.to],
    subject: params.subject,
    body_text: params.text,
    body_html: params.html || null,
    is_read: true,
    received_at: sentAt
  })

  return { saved: true }
}
