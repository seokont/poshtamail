<script setup lang='ts'>
import { AlertCircle, ArrowLeft, Download, LoaderCircle, MailOpen, Paperclip, Reply, Send, Trash2, X } from '@lucide/vue'
import sanitizeHtml from 'sanitize-html'

interface MessageDetail {
  id: string
  mailbox_id: string
  from_addr: string | null
  to_addrs: string[] | null
  subject: string | null
  body_html: string | null
  body_text: string | null
  received_at: string | null
}

interface AttachmentSummary {
  id: string
  filename: string | null
  content_type: string | null
  size_bytes: number | null
}

const route = useRoute()
const supabase = useSupabaseClient<any>()
const messageId = String(route.params.id)

const { data: message, pending, error } = await useAsyncData<MessageDetail | null>('message-' + messageId, async () => {
  const { data, error: fetchError } = await supabase
    .from('messages')
    .select('id, mailbox_id, from_addr, to_addrs, subject, body_html, body_text, received_at')
    .eq('id', messageId)
    .single()
  if (fetchError) throw fetchError
  return data
})

const { data: attachments } = await useAsyncData<AttachmentSummary[]>('attachments-' + messageId, async () => {
  const { data, error: fetchError } = await supabase
    .from('attachments')
    .select('id, filename, content_type, size_bytes')
    .eq('message_id', messageId)
  if (fetchError) throw fetchError
  return data ?? []
})

onMounted(async () => {
  if (!message.value) return
  await supabase.from('messages').update({ is_read: true }).eq('id', messageId)
})

const sanitizedBodyHtml = computed(() => {
  if (!message.value?.body_html) return null
  return sanitizeHtml(message.value.body_html, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer'
      })
    }
  })
})

const replying = ref(false)
const replyTo = ref('')
const replySubject = ref('')
const replyBody = ref('')
const sending = ref(false)
const sendError = ref('')
const sent = ref(false)
const deleting = ref(false)
const deleteError = ref('')

function emailAddress(value: string | null) {
  if (!value) return ''
  return value.match(/<([^>]+)>/)?.[1] || value.trim()
}

function senderName(value: string | null) {
  if (!value) return 'Unknown sender'
  return value.match(/^\s*([^<]+?)\s*</)?.[1]?.trim() || value.split('@')[0] || value
}

function senderInitial(value: string | null) {
  return senderName(value).charAt(0).toLocaleUpperCase('en')
}

function formatDate(value: string | null) {
  if (!value) return 'Date not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatBytes(value: number | null) {
  if (!value) return '0 B'
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB'
  return (value / 1024 / 1024).toFixed(1) + ' MB'
}

function startReply() {
  if (!message.value) return
  replyTo.value = emailAddress(message.value.from_addr)
  replySubject.value = message.value.subject?.startsWith('Re:')
    ? message.value.subject
    : 'Re: ' + (message.value.subject || '')
  replyBody.value = ''
  sendError.value = ''
  sent.value = false
  replying.value = true
}

async function sendReply() {
  if (!message.value) return
  sending.value = true
  sendError.value = ''

  try {
    await $fetch('/api/mail/send', {
      method: 'POST',
      body: {
        mailboxId: message.value.mailbox_id,
        to: replyTo.value.trim(),
        subject: replySubject.value.trim(),
        text: replyBody.value
      }
    })
    sent.value = true
    replyBody.value = ''
  } catch (cause: any) {
    sendError.value = cause?.data?.statusMessage || cause?.message || 'Could not send the reply'
  } finally {
    sending.value = false
  }
}

async function moveToTrash() {
  if (!message.value || deleting.value) return
  if (!confirm('Move this message to Trash?')) return

  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch('/api/mail/' + messageId, { method: 'DELETE' })
    await navigateTo('/')
  } catch (cause: any) {
    deleteError.value = cause?.data?.statusMessage || cause?.message || 'Could not move the message to Trash'
  } finally {
    deleting.value = false
  }
}

function attachmentUrl(attachmentId: string) {
  return '/api/attachments/' + attachmentId + '/download'
}
</script>

<template>
  <main class='message-page'>
    <header class='message-toolbar'>
      <NuxtLink class='back-link' to='/'>
        <ArrowLeft :size='18' />
        <span>Inbox</span>
      </NuxtLink>
      <div v-if='message' class='toolbar-actions'>
        <button class='secondary-button delete-button' type='button' title='Move to Trash' aria-label='Move to Trash' :disabled='deleting' @click='moveToTrash'>
          <LoaderCircle v-if='deleting' class='spin' :size='17' />
          <Trash2 v-else :size='17' />
          {{ deleting ? 'Moving' : 'Delete' }}
        </button>
        <button class='secondary-button' type='button' aria-label='Reply' :disabled='deleting' @click='startReply'>
          <Reply :size='17' />
          Reply
        </button>
      </div>
    </header>

    <p v-if='deleteError' class='delete-error' role='alert'>{{ deleteError }}</p>

    <section v-if='pending' class='message-state'>
      <LoaderCircle class='spin' :size='27' />
      <span>Opening message...</span>
    </section>

    <section v-else-if='error' class='message-state error-state' role='alert'>
      <AlertCircle :size='28' />
      <strong>Could not open this message</strong>
      <p>{{ error.message }}</p>
      <NuxtLink class='secondary-button' to='/'>Back to inbox</NuxtLink>
    </section>

    <article v-else-if='message' class='message-content'>
      <header class='message-heading'>
        <p class='message-label'><MailOpen :size='15' /> Incoming message</p>
        <h1>{{ message.subject || '(no subject)' }}</h1>

        <div class='sender-meta'>
          <span class='sender-avatar'>{{ senderInitial(message.from_addr) }}</span>
          <span class='sender-copy'>
            <strong>{{ senderName(message.from_addr) }}</strong>
            <small>{{ message.from_addr || 'Address not available' }}</small>
          </span>
          <time :datetime='message.received_at || undefined'>{{ formatDate(message.received_at) }}</time>
        </div>
        <p v-if='message.to_addrs?.length' class='recipient-line'>To: {{ message.to_addrs.join(', ') }}</p>
      </header>

      <div class='body-wrap'>
        <div v-if='sanitizedBodyHtml' class='mail-body html-body' v-html='sanitizedBodyHtml' />
        <pre v-else-if='message.body_text' class='mail-body text-body'>{{ message.body_text }}</pre>
        <p v-else class='empty-body'>This message has no body.</p>
      </div>

      <section v-if='attachments?.length' class='attachments'>
        <h2><Paperclip :size='17' /> Attachments <span>{{ attachments.length }}</span></h2>
        <ul>
          <li v-for='attachment in attachments' :key='attachment.id'>
            <span class='file-icon'><Paperclip :size='17' /></span>
            <span class='file-copy'>
              <strong>{{ attachment.filename || 'Attachment' }}</strong>
              <small>{{ attachment.content_type || 'File' }} · {{ formatBytes(attachment.size_bytes) }}</small>
            </span>
            <a class='icon-button' :href='attachmentUrl(attachment.id)' target='_blank' rel='noopener' title='Download' aria-label='Download'>
              <Download :size='18' />
            </a>
          </li>
        </ul>
      </section>

      <section v-if='replying' class='reply-panel'>
        <header>
          <div>
            <p>Reply</p>
            <h2>{{ replySubject }}</h2>
          </div>
          <button class='icon-button' type='button' title='Close reply' aria-label='Close reply' @click='replying = false'><X :size='18' /></button>
        </header>

        <form @submit.prevent='sendReply'>
          <label class='field'>
            <span class='field-label'>To</span>
            <input v-model='replyTo' class='field-control' type='email' required>
          </label>
          <label class='field'>
            <span class='field-label'>Subject</span>
            <input v-model='replySubject' class='field-control' type='text' required>
          </label>
          <label class='field'>
            <span class='field-label'>Message</span>
            <textarea v-model='replyBody' class='field-control' rows='7' required autofocus />
          </label>
          <p v-if='sendError' class='error-message' role='alert'>{{ sendError }}</p>
          <p v-if='sent' class='sent-message' role='status'>Reply sent.</p>
          <div class='reply-actions'>
            <button class='secondary-button' type='button' :disabled='sending' @click='replying = false'>Cancel</button>
            <button class='primary-button' type='submit' :disabled='sending'>
              <LoaderCircle v-if='sending' class='spin' :size='17' />
              <Send v-else :size='17' />
              {{ sending ? 'Sending' : 'Send reply' }}
            </button>
          </div>
        </form>
      </section>
    </article>
  </main>
</template>

<style scoped>
.message-page {
  min-height: 100dvh;
  background: var(--surface-subtle);
}

.message-toolbar {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 28px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.back-link:hover {
  color: var(--text);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-button {
  color: var(--danger);
}

.delete-button:hover {
  border-color: #f3b5bd;
  background: var(--danger-soft);
}

.delete-error {
  margin: 0;
  padding: 10px 28px;
  border-bottom: 1px solid #fecaca;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 13px;
}

.message-state {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 30px;
  color: var(--text-secondary);
  text-align: center;
}

.message-state p {
  margin: 0 0 12px;
}

.error-state {
  color: var(--danger);
}

.message-content {
  width: min(920px, calc(100% - 48px));
  margin: 24px auto 56px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.message-heading {
  padding: 28px 32px 22px;
  border-bottom: 1px solid var(--border);
}

.message-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 7px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.message-heading h1 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 25px;
  line-height: 1.3;
}

.sender-meta {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
}

.sender-avatar {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e7f7f2;
  color: var(--success);
  font-size: 13px;
  font-weight: 750;
}

.sender-copy {
  min-width: 0;
  display: grid;
}

.sender-copy strong,
.sender-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sender-copy strong {
  font-size: 13px;
}

.sender-copy small,
.sender-meta time,
.recipient-line {
  color: var(--text-secondary);
  font-size: 11px;
}

.recipient-line {
  margin: 10px 0 0 48px;
}

.body-wrap {
  padding: 32px;
}

.mail-body {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
  color: #253047;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.html-body :deep(a) {
  color: var(--accent);
}

.html-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.text-body {
  overflow: visible;
}

.empty-body {
  margin: 0;
  color: var(--text-secondary);
  font-style: italic;
}

.attachments {
  padding: 22px 32px 26px;
  border-top: 1px solid var(--border);
}

.attachments h2 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 13px;
  font-size: 14px;
}

.attachments h2 span {
  color: var(--text-secondary);
  font-size: 11px;
}

.attachments ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attachments li {
  min-height: 54px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 38px;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-subtle);
}

.file-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: #f5eadc;
  color: #925c19;
}

.file-copy {
  min-width: 0;
  display: grid;
}

.file-copy strong,
.file-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-copy strong {
  font-size: 12px;
}

.file-copy small {
  color: var(--text-secondary);
  font-size: 10px;
}

.reply-panel {
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
}

.reply-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--border);
}

.reply-panel header p,
.reply-panel header h2 {
  margin: 0;
}

.reply-panel header p {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 650;
}

.reply-panel header h2 {
  font-size: 15px;
}

.reply-panel form {
  display: grid;
  gap: 13px;
  padding: 20px 22px 22px;
}

.reply-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}

.sent-message {
  margin: 0;
  padding: 9px 11px;
  border-radius: 7px;
  background: var(--success-soft);
  color: var(--success);
  font-size: 13px;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 780px) {
  .message-page {
    min-height: calc(100dvh - 120px);
  }

  .message-toolbar {
    min-height: 56px;
    padding: 8px 14px;
  }

  .message-toolbar .secondary-button {
    min-width: 40px;
    padding-inline: 10px;
  }

  .delete-error {
    padding-inline: 14px;
  }

  .message-content {
    width: 100%;
    margin: 0;
    border: 0;
    border-radius: 0;
  }

  .message-heading {
    padding: 22px 16px 18px;
  }

  .message-heading h1 {
    font-size: 22px;
  }

  .sender-meta {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .sender-meta time {
    grid-column: 2;
  }

  .recipient-line {
    margin-left: 48px;
  }

  .body-wrap {
    padding: 24px 16px 30px;
  }

  .attachments {
    padding: 18px 16px 22px;
  }

  .reply-panel form {
    padding: 16px;
  }
}
</style>
