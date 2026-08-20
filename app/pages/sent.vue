<script setup lang='ts'>
import { AlertCircle, LoaderCircle, RefreshCw, Search, Send } from '@lucide/vue'

interface SentMessage {
  id: string
  mailbox_id: string
  subject: string | null
  to_addrs: string[] | null
  received_at: string | null
  is_read: boolean
}

const supabase = useSupabaseClient<any>()
const { mailboxes, selectedMailboxId, loading: mailboxesLoading, error: mailboxesError } = await useMailboxes()
const messages = ref<SentMessage[]>([])
const search = ref('')
const syncing = ref(false)
const syncError = ref('')

const { data, pending, error, refresh } = await useAsyncData('sent-messages', async () => {
  if (!selectedMailboxId.value) return []

  const { data: rows, error: fetchError } = await supabase
    .from('messages')
    .select('id, mailbox_id, subject, to_addrs, received_at, is_read, folders!inner(name)')
    .eq('mailbox_id', selectedMailboxId.value)
    .eq('folders.name', 'SENT')
    .order('received_at', { ascending: false })
    .limit(100)
  if (fetchError) throw fetchError
  return rows ?? []
}, { watch: [selectedMailboxId] })

watch(data, rows => {
  messages.value = (rows ?? []) as SentMessage[]
}, { immediate: true })

const activeMailbox = computed(() => mailboxes.value.find(mailbox => mailbox.id === selectedMailboxId.value))
const filteredMessages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('en')
  if (!query) return messages.value

  return messages.value.filter(message =>
    message.subject?.toLocaleLowerCase('en').includes(query)
    || recipientLabel(message.to_addrs).toLocaleLowerCase('en').includes(query))
})

function recipientLabel(recipients: string[] | null) {
  return recipients?.filter(Boolean).join(', ') || 'Unknown recipient'
}

function recipientInitial(recipients: string[] | null) {
  return recipientLabel(recipients).charAt(0).toLocaleUpperCase('en')
}

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat('en-US', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' }).format(date)
}

async function syncMessages() {
  if (!selectedMailboxId.value || syncing.value) return

  syncing.value = true
  syncError.value = ''
  try {
    await $fetch('/api/mail/sync', {
      method: 'POST',
      body: { mailboxId: selectedMailboxId.value }
    })
    await refresh()
  } catch (cause: any) {
    syncError.value = cause?.data?.statusMessage || cause?.message || 'Could not sync the mailbox'
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <main class='sent-page'>
    <header class='page-header'>
      <div>
        <p class='eyebrow'>{{ activeMailbox?.email || 'Mailbox' }}</p>
        <h1>Sent</h1>
      </div>

      <div class='header-actions'>
        <label class='mailbox-picker'>
          <span class='sr-only'>Mailbox</span>
          <select v-model='selectedMailboxId' :disabled='mailboxesLoading || mailboxes.length === 0'>
            <option v-if='mailboxes.length === 0' :value='null'>No mailboxes</option>
            <option v-for='mailbox in mailboxes' :key='mailbox.id' :value='mailbox.id'>{{ mailbox.email }}</option>
          </select>
        </label>
        <button class='icon-button' type='button' title='Refresh' aria-label='Refresh' :disabled='pending || syncing' @click='syncMessages'>
          <LoaderCircle v-if='syncing' :size='18' class='spin' />
          <RefreshCw v-else :size='18' />
        </button>
      </div>
    </header>

    <div class='mail-toolbar'>
      <label class='search-box'>
        <Search :size='17' />
        <span class='sr-only'>Search sent messages</span>
        <input v-model='search' type='search' placeholder='Search by recipient or subject'>
      </label>
      <span class='message-total'>{{ filteredMessages.length }} {{ filteredMessages.length === 1 ? 'message' : 'messages' }}</span>
    </div>

    <p v-if='syncError' class='sync-error' role='alert'>{{ syncError }}</p>

    <section v-if='mailboxesError' class='state-panel error-state' role='alert'>
      <AlertCircle :size='28' />
      <div><strong>Could not load mailboxes</strong><p>{{ mailboxesError }}</p></div>
    </section>

    <section v-else-if='error' class='state-panel error-state' role='alert'>
      <AlertCircle :size='28' />
      <div><strong>Could not load sent messages</strong><p>{{ error.message }}</p></div>
      <button class='secondary-button' type='button' @click='refresh()'>Try again</button>
    </section>

    <section v-else-if='pending && messages.length === 0' class='state-panel'>
      <LoaderCircle class='spin' :size='28' />
      <span>Loading sent messages...</span>
    </section>

    <section v-else-if='filteredMessages.length === 0' class='state-panel empty-state'>
      <span class='empty-icon'><Send :size='28' /></span>
      <strong>{{ search ? 'No results found' : 'No sent messages' }}</strong>
      <p>{{ search ? 'Try a different search.' : 'Messages sent from this mailbox will appear here.' }}</p>
    </section>

    <ul v-else class='message-list'>
      <li v-for='message in filteredMessages' :key='message.id'>
        <NuxtLink :to='`/mail/${message.id}`' class='message-row'>
          <span class='recipient-avatar'>{{ recipientInitial(message.to_addrs) }}</span>
          <span class='recipient' :title='recipientLabel(message.to_addrs)'>To: {{ recipientLabel(message.to_addrs) }}</span>
          <span class='subject'>{{ message.subject || '(no subject)' }}</span>
          <time class='message-date' :datetime='message.received_at || undefined'>{{ formatDate(message.received_at) }}</time>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.sent-page { min-height: 100dvh; }

.page-header {
  min-height: 116px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border);
}

.page-header h1,
.eyebrow { margin: 0; }
.page-header h1 { font-size: 27px; line-height: 1.2; }
.eyebrow { margin-bottom: 3px; color: var(--text-secondary); font-size: 12px; }
.header-actions { display: flex; align-items: center; gap: 6px; }

.mailbox-picker select {
  width: min(250px, 36vw);
  height: 38px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  padding: 0 28px 0 10px;
}

.mail-toolbar {
  min-height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 32px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
}

.search-box {
  width: min(480px, 70%);
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text-secondary);
  padding: 0 11px;
}

.search-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
.search-box input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); }
.message-total { color: var(--text-secondary); font-size: 12px; }
.sync-error { margin: 0; padding: 10px 32px; border-bottom: 1px solid #fecaca; background: #fff1f2; color: var(--danger); font-size: 13px; }

.message-list { margin: 0; padding: 0; list-style: none; }
.message-list li { border-bottom: 1px solid var(--border); }
.message-row {
  min-height: 64px;
  display: grid;
  grid-template-columns: 34px minmax(150px, 0.9fr) minmax(180px, 1.8fr) 72px;
  align-items: center;
  gap: 12px;
  padding: 8px 32px;
  color: var(--text);
  text-decoration: none;
}
.message-row:hover { background: var(--surface-hover); }
.recipient-avatar { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: #e9f1ff; color: #245fbf; font-size: 12px; font-weight: 750; }
.recipient,
.subject { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recipient { color: #39445a; font-size: 13px; font-weight: 650; }
.subject { color: var(--text-secondary); font-size: 14px; }
.message-date { color: var(--text-secondary); font-size: 11px; text-align: right; }

.state-panel { min-height: 320px; display: flex; align-items: center; justify-content: center; gap: 14px; padding: 30px; color: var(--text-secondary); text-align: center; }
.state-panel p { max-width: 430px; margin: 4px 0 0; font-size: 13px; }
.state-panel strong { color: var(--text); }
.empty-state { flex-direction: column; }
.empty-icon { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; background: #e9f1ff; color: #245fbf; }
.error-state { color: var(--danger); }
.error-state > div { text-align: left; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 780px) {
  .sent-page { min-height: calc(100dvh - 120px); }
  .page-header { min-height: 94px; padding: 18px 16px 14px; }
  .page-header h1 { font-size: 23px; }
  .eyebrow { max-width: 44vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mailbox-picker select { width: min(44vw, 180px); }
  .mail-toolbar { min-height: 58px; padding: 9px 16px; }
  .search-box { width: 100%; }
  .message-total { display: none; }
  .sync-error { padding-inline: 16px; }
  .message-row { min-height: 68px; grid-template-columns: 34px minmax(0, 1fr) 58px; grid-template-rows: 22px 22px; gap: 0 10px; padding: 8px 16px; }
  .recipient-avatar { grid-row: 1 / 3; }
  .recipient { align-self: end; }
  .subject { grid-column: 2 / 4; align-self: start; }
  .message-date { grid-row: 1; grid-column: 3; }
}
</style>
