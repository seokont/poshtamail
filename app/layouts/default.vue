<script setup lang='ts'>
import { Inbox, LogOut, Mail, PencilLine, UserRound } from '@lucide/vue'

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { mailboxes, selectedMailboxId, loading: mailboxesLoading, error: mailboxesError } = await useMailboxes()
const composeOpen = ref(false)
const signingOut = ref(false)

const activeMailbox = computed(() => mailboxes.value.find(mailbox => mailbox.id === selectedMailboxId.value))
const accountLabel = computed(() => user.value?.email || 'User')
const isInbox = computed(() => route.path === '/')

async function chooseMailbox(mailboxId: string) {
  selectedMailboxId.value = mailboxId
  if (!isInbox.value) await navigateTo('/')
}

async function signOut() {
  signingOut.value = true
  try {
    await supabase.auth.signOut()
    await navigateTo('/login')
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class='app-shell'>
    <aside class='sidebar'>
      <NuxtLink class='brand' to='/' aria-label='Mail, inbox'>
        <span class='brand-mark'><Mail :size='21' stroke-width='2.2' /></span>
        <span>Mail</span>
      </NuxtLink>

      <button class='compose-button' type='button' @click='composeOpen = true'>
        <PencilLine :size='18' />
        Compose
      </button>

      <nav class='primary-nav' aria-label='Folders'>
        <NuxtLink to='/' :class='{ active: isInbox }'>
          <Inbox :size='18' />
          <span>Inbox</span>
        </NuxtLink>
      </nav>

      <section class='mailbox-section'>
        <p class='sidebar-label'>Mailboxes</p>
        <p v-if='mailboxesLoading' class='sidebar-hint'>Loading...</p>
        <p v-else-if='mailboxesError' class='sidebar-error'>{{ mailboxesError }}</p>
        <p v-else-if='mailboxes.length === 0' class='sidebar-hint'>No mailboxes available</p>
        <button
          v-for='mailbox in mailboxes'
          :key='mailbox.id'
          class='mailbox-link'
          :class='{ active: mailbox.id === selectedMailboxId }'
          type='button'
          :title='mailbox.email'
          @click='chooseMailbox(mailbox.id)'
        >
          <span class='mailbox-dot' />
          <span>{{ mailbox.email }}</span>
        </button>
      </section>

      <div class='account'>
        <span class='account-avatar'><UserRound :size='18' /></span>
        <span class='account-copy'>
          <strong>{{ accountLabel }}</strong>
          <small>{{ activeMailbox?.email || 'Mail client' }}</small>
        </span>
        <button class='icon-button' type='button' title='Sign out' aria-label='Sign out' :disabled='signingOut' @click='signOut'>
          <LogOut :size='18' />
        </button>
      </div>
    </aside>

    <section class='workspace'>
      <header class='mobile-header'>
        <NuxtLink class='brand compact' to='/'>
          <span class='brand-mark'><Mail :size='19' /></span>
          <span>Mail</span>
        </NuxtLink>
        <span class='mobile-mailbox'>{{ activeMailbox?.email }}</span>
      </header>

      <slot />
    </section>

    <nav class='mobile-nav' aria-label='Main navigation'>
      <NuxtLink to='/' :class='{ active: isInbox }'>
        <Inbox :size='20' />
        <span>Inbox</span>
      </NuxtLink>
      <button type='button' class='mobile-compose' @click='composeOpen = true'>
        <PencilLine :size='21' />
        <span>Compose</span>
      </button>
      <button type='button' :disabled='signingOut' @click='signOut'>
        <LogOut :size='20' />
        <span>Sign out</span>
      </button>
    </nav>

    <ComposeModal
      :open='composeOpen'
      :mailboxes='mailboxes'
      :selected-mailbox-id='selectedMailboxId'
      @close='composeOpen = false'
      @update:selected-mailbox-id='selectedMailboxId = $event'
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
}

.sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 14px 14px;
  border-right: 1px solid var(--border);
  background: var(--bg);
}

.brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  color: var(--text);
  font-size: 19px;
  font-weight: 760;
  text-decoration: none;
}

.brand-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
}

.compose-button {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin: 20px 4px 12px;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.compose-button:hover {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}

.primary-nav a,
.mailbox-link {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  padding: 0 11px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.primary-nav a:hover,
.mailbox-link:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.primary-nav a.active,
.mailbox-link.active {
  background: var(--accent-soft);
  color: #164eb8;
  font-weight: 700;
}

.mailbox-section {
  min-height: 0;
  overflow: auto;
  margin-top: 16px;
}

.sidebar-label {
  margin: 0 11px 7px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 760;
  text-transform: uppercase;
}

.sidebar-hint,
.sidebar-error {
  margin: 8px 11px;
  font-size: 12px;
}

.sidebar-hint {
  color: var(--text-secondary);
}

.sidebar-error {
  color: var(--danger);
}

.mailbox-link span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mailbox-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: #21a179;
}

.account {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 38px;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 13px;
  border-top: 1px solid var(--border);
}

.account-avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f5eadc;
  color: #925c19;
}

.account-copy {
  min-width: 0;
  display: grid;
}

.account-copy strong,
.account-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-copy strong {
  font-size: 12px;
}

.account-copy small {
  color: var(--text-secondary);
  font-size: 10px;
}

.workspace {
  min-width: 0;
  min-height: 100dvh;
  background: var(--surface);
}

.mobile-header,
.mobile-nav {
  display: none;
}

@media (max-width: 780px) {
  .app-shell {
    display: block;
    padding-bottom: 64px;
  }

  .sidebar {
    display: none;
  }

  .workspace {
    min-height: calc(100dvh - 64px);
  }

  .mobile-header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 15px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand.compact {
    padding: 0;
    font-size: 17px;
  }

  .brand.compact .brand-mark {
    width: 30px;
    height: 30px;
    flex-basis: 30px;
  }

  .mobile-mailbox {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-nav {
    position: fixed;
    z-index: 50;
    right: 0;
    bottom: 0;
    left: 0;
    height: 64px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.96);
  }

  .mobile-nav a,
  .mobile-nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 10px;
    text-decoration: none;
  }

  .mobile-nav .active {
    color: var(--accent);
  }

  .mobile-nav .mobile-compose {
    color: var(--text);
    font-weight: 700;
  }
}
</style>
