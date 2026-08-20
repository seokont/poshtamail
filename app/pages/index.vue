<script setup lang='ts'>
import { AlertCircle, Inbox, LoaderCircle, RefreshCw, Search } from '@lucide/vue'
import type { MailMessage } from '~/composables/useMailRealtime'

const supabase = useSupabaseClient<any>()
const { mailboxes, selectedMailboxId, loading: mailboxesLoading, error: mailboxesError } = await useMailboxes()
const messages = ref<MailMessage[]>([])
const search = ref('')
const syncing = ref(false)
const syncError = ref('')

const { data, pending, error, refresh } = await useAsyncData('inbox-messages', async () => {
  if (!selectedMailboxId.value) return []

  const { data: rows, error: fetchError } = await supabase
    .from('messages')
    .select('id, mailbox_id, subject, from_addr, received_at, is_read, folders!inner(name)')
    .eq('mailbox_id', selectedMailboxId.value)
    .eq('folders.name', 'INBOX')
    .order('received_at', { ascending: false })
    .limit(100)
  if (fetchError) throw fetchError
  return rows ?? []
}, { watch: [selectedMailboxId] })

watch(data, rows => {
  messages.value = (rows ?? []) as MailMessage[]
}, { immediate: true })

useMailRealtime(messages, selectedMailboxId)

const activeMailbox = computed(() => mailboxes.value.find(mailbox => mailbox.id === selectedMailboxId.value))
const unreadCount = computed(() => messages.value.filter(message => !message.is_read).length)
const filteredMessages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('en')
  if (!query) return messages.value

  return messages.value.filter(message =>
    message.subject?.toLocaleLowerCase('en').includes(query)
    || message.from_addr?.toLocaleLowerCase('en').includes(query))
})

function senderLabel(sender: string | null) {
  if (!sender) return 'Unknown sender'
  const angleName = sender.match(/^\s*([^<]+?)\s*</)?.[1]
  if (angleName) return angleName.replace(/^['']|['']$/g, '')
  return sender.split('@')[0] || sender
}

function senderInitial(sender: string | null) {
  return senderLabel(sender).charAt(0).toLocaleUpperCase('en')
}

function messageUrl(messageId: string) {
  return '/mail/' + messageId
}

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
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
  <main class='inbox-page'>
    <header class='page-header'>
      <div class='title-group'>
        <p class='eyebrow'>{{ activeMailbox?.email || 'Mailbox' }}</p>
        <h1>Inbox</h1>
        <span v-if='unreadCount' class='unread-count'>{{ unreadCount }} unread</span>
      </div>

      <div class='header-actions'>
        <label class='mailbox-picker'>
          <span class='sr-only'>Mailbox</span>
          <select v-model='selectedMailboxId' :disabled='mailboxesLoading || mailboxes.length === 0'>
            <option v-if='mailboxes.length === 0' :value='null'>No mailboxes</option>
            <option v-for='mailbox in mailboxes' :key='mailbox.id' :value='mailbox.id'>
              {{ mailbox.email }}
            </option>
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
        <span class='sr-only'>Search messages</span>
        <input v-model='search' type='search' placeholder='Search by sender or subject'>
      </label>
      <span class='message-total'>{{ filteredMessages.length }} {{ filteredMessages.length === 1 ? 'message' : 'messages' }}</span>
    </div>

    <p v-if='syncError' class='sync-error' role='alert'>{{ syncError }}</p>

    <section v-if='mailboxesError' class='state-panel error-state' role='alert'>
      <AlertCircle :size='28' />
      <div>
        <strong>Could not load mailboxes</strong>
        <p>{{ mailboxesError }}</p>
      </div>
    </section>

    <section v-else-if='error' class='state-panel error-state' role='alert'>
      <AlertCircle :size='28' />
      <div>
        <strong>Could not load messages</strong>
        <p>{{ error.message }}</p>
      </div>
      <button class='secondary-button' type='button' @click='refresh()'>Try again</button>
    </section>

    <div v-else-if='pending && messages.length === 0' class='message-list loading-list' aria-label='Loading messages'>
      <div v-for='index in 6' :key='index' class='message-row skeleton-row'>
        <span class='skeleton avatar-skeleton' />
        <span class='skeleton sender-skeleton' />
        <span class='skeleton subject-skeleton' />
        <span class='skeleton date-skeleton' />
      </div>
    </div>

    <section v-else-if='filteredMessages.length === 0' class='state-panel empty-state'>
      <span class='empty-icon'><Inbox :size='28' /></span>
      <strong>{{ search ? 'No results found' : 'Your inbox is empty' }}</strong>
      <p>{{ search ? 'Try a different search.' : 'Use Refresh to check for new messages.' }}</p>
    </section>

    <ul v-else class='message-list'>
      <li v-for='message in filteredMessages' :key='message.id'>
        <NuxtLink :to='messageUrl(message.id)' class='message-row' :class='{ unread: !message.is_read }'>
          <span class='unread-dot' aria-hidden='true' />
          <span class='sender-avatar'>{{ senderInitial(message.from_addr) }}</span>
          <span class='sender' :title='message.from_addr || undefined'>{{ senderLabel(message.from_addr) }}</span>
          <span class='subject'>{{ message.subject || '(no subject)' }}</span>
          <time class='message-date' :datetime='message.received_at || undefined'>{{ formatDate(message.received_at) }}</time>
        </NuxtLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.inbox-page {
  min-height: 100dvh;
}

.page-header {
  min-height: 116px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border);
}

.title-group {
  position: relative;
}

.title-group h1,
.eyebrow {
  margin: 0;
}

.title-group h1 {
  font-size: 27px;
  line-height: 1.2;
}

.eyebrow {
  margin-bottom: 3px;
  color: var(--text-secondary);
  font-size: 12px;
}

.unread-count {
  position: absolute;
  left: calc(100% + 12px);
  bottom: 2px;
  width: max-content;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: #164eb8;
  font-size: 11px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

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

.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}

.search-box input::placeholder {
  color: #929cac;
}

.message-total {
  color: var(--text-secondary);
  font-size: 12px;
}

.sync-error {
  margin: 0;
  padding: 10px 32px;
  border-bottom: 1px solid #fecaca;
  background: #fff1f2;
  color: var(--danger);
  font-size: 13px;
}

.message-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.message-list li {
  border-bottom: 1px solid var(--border);
}

.message-row {
  min-height: 64px;
  display: grid;
  grid-template-columns: 8px 34px minmax(130px, 0.8fr) minmax(180px, 1.8fr) 72px;
  align-items: center;
  gap: 12px;
  padding: 8px 32px 8px 22px;
  color: var(--text);
  text-decoration: none;
}

a.message-row:hover {
  background: var(--surface-hover);
}

.unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.message-row.unread .unread-dot {
  background: var(--accent);
}

.sender-avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #edf0f5;
  color: #4a566c;
  font-size: 12px;
  font-weight: 750;
}

.message-row.unread .sender-avatar {
  background: #e7f7f2;
  color: #147d64;
}

.sender,
.subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sender {
  color: #39445a;
  font-size: 13px;
}

.message-row.unread .sender,
.message-row.unread .subject {
  color: var(--text);
  font-weight: 720;
}

.subject {
  color: var(--text-secondary);
  font-size: 14px;
}

.message-date {
  color: var(--text-secondary);
  font-size: 11px;
  text-align: right;
}

.state-panel {
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 30px;
  color: var(--text-secondary);
  text-align: center;
}

.state-panel p {
  max-width: 430px;
  margin: 4px 0 0;
  font-size: 13px;
}

.state-panel strong {
  color: var(--text);
}

.empty-state {
  flex-direction: column;
}

.empty-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #edf0f5;
  color: #5c687d;
}

.error-state {
  color: var(--danger);
}

.error-state > div {
  text-align: left;
}

.loading-list {
  overflow: hidden;
}

.skeleton-row {
  border-bottom: 1px solid var(--border);
}

.skeleton {
  display: block;
  height: 12px;
  border-radius: 5px;
  background: #e9edf3;
  animation: pulse 1.4s ease-in-out infinite;
}

.avatar-skeleton {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  grid-column: 2;
}

.sender-skeleton {
  width: 70%;
}

.subject-skeleton {
  width: 88%;
}

.date-skeleton {
  width: 48px;
  justify-self: end;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes pulse {
  50% { opacity: 0.5; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 780px) {
  .inbox-page {
    min-height: calc(100dvh - 120px);
  }

  .page-header {
    min-height: 94px;
    padding: 18px 16px 14px;
  }

  .title-group h1 {
    font-size: 23px;
  }

  .unread-count {
    position: static;
    display: inline-block;
    margin-top: 6px;
  }

  .header-actions {
    align-self: flex-end;
  }

  .mailbox-picker select {
    width: min(44vw, 210px);
  }

  .mail-toolbar {
    min-height: 58px;
    padding: 9px 16px;
  }

  .sync-error {
    padding-inline: 16px;
  }

  .search-box {
    width: 100%;
  }

  .message-total {
    display: none;
  }

  .message-row {
    min-height: 68px;
    grid-template-columns: 7px 34px minmax(0, 1fr) 58px;
    grid-template-rows: 22px 22px;
    gap: 0 10px;
    padding: 8px 16px 8px 9px;
  }

  .unread-dot {
    grid-row: 1 / 3;
  }

  .sender-avatar {
    grid-row: 1 / 3;
  }

  .sender {
    align-self: end;
  }

  .subject {
    grid-column: 3 / 5;
    align-self: start;
  }

  .message-date {
    grid-row: 1;
    grid-column: 4;
  }

  .avatar-skeleton {
    grid-row: 1 / 3;
    grid-column: 2;
  }

  .sender-skeleton {
    grid-column: 3;
  }

  .subject-skeleton {
    grid-row: 2;
    grid-column: 3 / 5;
  }

  .date-skeleton {
    grid-row: 1;
    grid-column: 4;
  }
}

@media (max-width: 430px) {
  .eyebrow {
    max-width: 44vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mailbox-picker select {
    width: 128px;
  }
}
</style>
