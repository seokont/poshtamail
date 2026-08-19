export interface MailboxSummary {
  id: string
  email: string
}

export async function useMailboxes() {
  const supabase = useSupabaseClient()
  const mailboxes = useState<MailboxSummary[]>('mailboxes', () => [])
  const selectedMailboxId = useState<string | null>('selected-mailbox-id', () => null)
  const loading = useState('mailboxes-loading', () => false)
  const loaded = useState('mailboxes-loaded', () => false)
  const error = useState<string | null>('mailboxes-error', () => null)

  async function refreshMailboxes() {
    if (loading.value) return
    loading.value = true
    error.value = null

    try {
      const { data, error: fetchError } = await supabase
        .from('mailboxes')
        .select('id, email')
        .order('email')
      if (fetchError) throw fetchError

      mailboxes.value = (data ?? []) as MailboxSummary[]
      if (!mailboxes.value.some(mailbox => mailbox.id === selectedMailboxId.value)) {
        selectedMailboxId.value = mailboxes.value[0]?.id ?? null
      }
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load mailboxes'
    } finally {
      loading.value = false
    }
  }

  if (!loaded.value && !loading.value) {
    await refreshMailboxes()
  }

  return {
    mailboxes,
    selectedMailboxId,
    loading,
    error,
    refreshMailboxes
  }
}
