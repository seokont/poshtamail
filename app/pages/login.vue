<script setup lang='ts'>
import { Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, Mail, ShieldCheck } from '@lucide/vue'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const loading = ref(false)
const showPassword = ref(false)
const passwordType = computed(() => showPassword.value ? 'text' : 'password')
const passwordActionLabel = computed(() => showPassword.value ? 'Hide password' : 'Show password')

async function handleLogin() {
  loading.value = true
  errorMessage.value = ''

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value
    })
    if (error) {
      errorMessage.value = error.message
      return
    }
    await navigateTo('/')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class='login-page'>
    <section class='login-intro'>
      <div class='brand-lockup'>
        <span class='brand-mark'><Mail :size='24' /></span>
        <span>Mail</span>
      </div>
      <div class='intro-copy'>
        <p class='eyebrow'>Team email</p>
        <h1>Every team mailbox in one place</h1>
        <p>Messages, replies, and attachments are available only to team members with assigned access.</p>
      </div>
      <p class='security-note'><ShieldCheck :size='17' /> Secured by Supabase Auth</p>
    </section>

    <section class='login-panel'>
      <form class='login-form' @submit.prevent='handleLogin'>
        <header>
          <span class='form-icon'><LockKeyhole :size='20' /></span>
          <div>
            <p>Your account</p>
            <h2>Sign in to Mail</h2>
          </div>
        </header>

        <label class='field'>
          <span class='field-label'>Email</span>
          <input v-model='email' class='field-control' type='email' required autocomplete='email' placeholder='name@company.com'>
        </label>

        <label class='field'>
          <span class='field-label'>Password</span>
          <span class='password-control'>
            <input
              v-model='password'
              class='field-control'
              :type='passwordType'
              required
              autocomplete='current-password'
              placeholder='Enter your password'
            >
            <button type='button' :title='passwordActionLabel' :aria-label='passwordActionLabel' @click='showPassword = !showPassword'>
              <EyeOff v-if='showPassword' :size='18' />
              <Eye v-else :size='18' />
            </button>
          </span>
        </label>

        <p v-if='errorMessage' class='error-message' role='alert'>{{ errorMessage }}</p>

        <button class='primary-button submit-button' type='submit' :disabled='loading'>
          <LoaderCircle v-if='loading' class='spin' :size='18' />
          <LogIn v-else :size='18' />
          {{ loading ? 'Signing in' : 'Sign in' }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  background: #edf1f6;
}

.login-intro {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: clamp(30px, 5vw, 68px);
  background: #182235;
  color: #fff;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 20px;
  font-weight: 760;
}

.brand-mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--accent);
}

.intro-copy {
  max-width: 480px;
  margin: auto 0;
}

.intro-copy .eyebrow {
  margin: 0 0 10px;
  color: #9eb7e9;
  font-size: 12px;
  font-weight: 720;
  text-transform: uppercase;
}

.intro-copy h1 {
  margin: 0;
  font-size: clamp(34px, 4.4vw, 58px);
  line-height: 1.08;
  letter-spacing: 0;
}

.intro-copy > p:last-child {
  max-width: 440px;
  margin: 22px 0 0;
  color: #b8c2d3;
  font-size: 15px;
}

.security-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #aeb9cc;
  font-size: 12px;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: 32px;
}

.login-form {
  width: min(430px, 100%);
  display: grid;
  gap: 18px;
  padding: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 14px 36px rgba(31, 44, 68, 0.11);
}

.login-form header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.form-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #f5eadc;
  color: #925c19;
}

.login-form header p,
.login-form header h2 {
  margin: 0;
}

.login-form header p {
  color: var(--text-secondary);
  font-size: 11px;
}

.login-form header h2 {
  font-size: 22px;
}

.password-control {
  position: relative;
  display: block;
}

.password-control input {
  padding-right: 44px;
}

.password-control button {
  position: absolute;
  top: 2px;
  right: 2px;
  bottom: 2px;
  width: 40px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.password-control button:hover {
  background: var(--surface-hover);
}

.submit-button {
  width: 100%;
  min-height: 44px;
  margin-top: 4px;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 800px) {
  .login-page {
    display: block;
    background: #182235;
  }

  .login-intro {
    min-height: auto;
    padding: 24px 20px 48px;
  }

  .intro-copy {
    margin: 52px 0 0;
  }

  .intro-copy h1 {
    font-size: 34px;
  }

  .security-note {
    display: none;
  }

  .login-panel {
    margin-top: -18px;
    padding: 0 14px 28px;
  }

  .login-form {
    padding: 24px 20px;
    box-shadow: none;
  }
}
</style>
