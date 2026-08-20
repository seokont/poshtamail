import { ImapFlow } from 'imapflow'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto'
import { buildImapConfig, ensureFolderId } from './imap'
import { assertMailboxAccess } from './mailboxAccess'

interface TrashImapClient {
  connect(): Promise<unknown>
  list(): Promise<Array<{ path: string; delimiter: string; specialUse?: string }>>
  mailboxCreate(path: string): Promise<{ path: string }>
  getMailboxLock(path: string): Promise<{ release(): void }>
  messageMove(
    range: number[],
    destination: string,
    options: { uid: true }
  ): Promise<{ uidMap?: Map<number, number> } | false>
  logout(): Promise<unknown>
}

export type TrashImapClientFactory = (
  config: ReturnType<typeof buildImapConfig>
) => TrashImapClient

function fallbackTrashPath(folders: Array<{ path: string; delimiter: string; specialUse?: string }>): string {
  const inbox = folders.find(folder => folder.specialUse === '\\Inbox' || folder.path.toUpperCase() === 'INBOX')
  return inbox ? `${inbox.path}${inbox.delimiter}Trash` : 'Trash'
}

export async function trashMailForUser(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
  createClient: TrashImapClientFactory = config => new ImapFlow(config)
): Promise<{ ok: true }> {
  const { data: message, error: messageErr } = await admin
    .from('messages')
    .select('id, mailbox_id, folder_id, imap_uid')
    .eq('id', messageId)
    .single()
  if (messageErr || !message) {
    const error = new Error('Message not found') as Error & { statusCode: number }
    error.statusCode = 404
    throw error
  }

  await assertMailboxAccess(admin, userId, message.mailbox_id)

  const [{ data: mailbox, error: mailboxErr }, { data: folder, error: folderErr }] = await Promise.all([
    admin
      .from('mailboxes')
      .select('id, email, imap_host, imap_port, smtp_host, smtp_port, imap_password_encrypted')
      .eq('id', message.mailbox_id)
      .single(),
    admin.from('folders').select('name').eq('id', message.folder_id).single()
  ])
  if (mailboxErr || !mailbox) throw new Error(mailboxErr?.message || 'Mailbox not found')
  if (folderErr || !folder) throw new Error(folderErr?.message || 'Folder not found')

  const sourceUid = Number(message.imap_uid)
  const client = createClient(buildImapConfig(mailbox, decrypt(mailbox.imap_password_encrypted)))
  await client.connect()

  let destinationUid = sourceUid
  let trashPath = 'Trash'
  try {
    const folders = await client.list()
    const existingTrash = folders.find(item => item.specialUse === '\\Trash')
    trashPath = existingTrash?.path || fallbackTrashPath(folders)
    if (!existingTrash) {
      trashPath = (await client.mailboxCreate(trashPath)).path
    }

    const lock = await client.getMailboxLock(folder.name)
    try {
      const moved = await client.messageMove([sourceUid], trashPath, { uid: true })
      destinationUid = moved && moved.uidMap?.get(sourceUid) || sourceUid
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  const trashFolderId = await ensureFolderId(admin, message.mailbox_id, trashPath)
  const { error: updateErr } = await admin
    .from('messages')
    .update({ folder_id: trashFolderId, imap_uid: destinationUid, is_read: true })
    .eq('id', messageId)
  if (updateErr) throw new Error(updateErr.message)

  return { ok: true }
}
