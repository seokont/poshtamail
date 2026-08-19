import { onScopeDispose, type Ref } from 'vue'

export interface MailMessage {
  id: string
  mailbox_id: string
  subject: string | null
  from_addr: string | null
  received_at: string | null
  is_read: boolean
}

export function useMailRealtime(
  messages: Ref<MailMessage[]>,
  mailboxId?: Readonly<Ref<string | null>>
) {
  const supabase = useSupabaseClient()

  const channel = supabase
    .channel('inbox-updates')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload: { new: MailMessage }) => {
        if (mailboxId?.value && payload.new.mailbox_id !== mailboxId.value) return
        if (messages.value.some(message => message.id === payload.new.id)) return
        messages.value = [payload.new, ...messages.value]
      }
    )
    .subscribe()

  onScopeDispose(() => {
    supabase.removeChannel(channel)
  })

  return { channel }
}
