<script setup lang="ts">
import { Check, LoaderCircle, Send, X } from "@lucide/vue";
import type { MailboxSummary } from "~/composables/useMailboxes";

const props = defineProps<{
  open: boolean;
  mailboxes: MailboxSummary[];
  selectedMailboxId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  sent: [];
  "update:selectedMailboxId": [value: string];
}>();

const to = ref("");
const subject = ref("");
const body = ref("");
const sending = ref(false);
const sendError = ref("");
const sent = ref(false);
const toInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    sendError.value = "";
    sent.value = false;
    await nextTick();
    toInput.value?.focus();
  },
);

function close() {
  if (!sending.value) emit("close");
}

function selectMailbox(event: Event) {
  emit("update:selectedMailboxId", (event.target as HTMLSelectElement).value);
}

function onBodyInput(event: Event) {
  body.value = (event.target as HTMLElement).innerHTML;
}

async function sendMessage() {
  if (!props.selectedMailboxId) {
    sendError.value = "Select a mailbox";
    return;
  }

  sending.value = true;
  sendError.value = "";
  try {
    await $fetch("/api/mail/send", {
      method: "POST",
      body: {
        mailboxId: props.selectedMailboxId,
        to: to.value.trim(),
        subject: subject.value.trim(),
        html: body.value,
      },
    });
    sent.value = true;
    to.value = "";
    subject.value = "";
    body.value = "";
    emit("sent");
  } catch (cause: any) {
    sendError.value =
      cause?.data?.statusMessage ||
      cause?.message ||
      "Could not send the message";
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="compose-backdrop" @mousedown.self="close">
      <section
        class="compose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
      >
        <header class="compose-header">
          <div>
            <p class="compose-eyebrow">New message</p>
            <h2 id="compose-title">Compose message</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            title="Close"
            aria-label="Close"
            @click="close"
          >
            <X :size="19" />
          </button>
        </header>

        <div v-if="sent" class="sent-state" role="status">
          <span class="sent-icon"><Check :size="24" /></span>
          <strong>Message sent</strong>
          <button class="secondary-button" type="button" @click="close">
            Close
          </button>
        </div>

        <form v-else class="compose-form" @submit.prevent="sendMessage">
          <label class="field">
            <span class="field-label">From</span>
            <select
              class="field-control"
              :value="selectedMailboxId"
              required
              @change="selectMailbox"
            >
              <option value="" disabled>Select a mailbox</option>
              <option
                v-for="mailbox in mailboxes"
                :key="mailbox.id"
                :value="mailbox.id"
              >
                {{ mailbox.email }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">To</span>
            <input
              ref="toInput"
              v-model="to"
              class="field-control"
              type="text"
              autocomplete="email"
              required
              placeholder="name@example.com"
            />
          </label>

          <label class="field">
            <span class="field-label">Subject</span>
            <input
              v-model="subject"
              class="field-control"
              type="text"
              maxlength="998"
              required
              placeholder="What is this message about?"
            />
          </label>

          <label class="field">
            <span class="field-label">Message</span>
            <div
              class="field-control message-field contenteditable"
              contenteditable="true"
              @input="onBodyInput"
              required
              placeholder="Write your message"
              role="textbox"
              aria-multiline="true"
            ></div>
          </label>

          <p v-if="sendError" class="error-message" role="alert">
            {{ sendError }}
          </p>

          <footer class="compose-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="sending"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="primary-button"
              type="submit"
              :disabled="sending || !selectedMailboxId"
            >
              <LoaderCircle v-if="sending" class="spin" :size="17" />
              <Send v-else :size="17" />
              {{ sending ? "Sending" : "Send" }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.compose-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(20, 30, 48, 0.46);
}

.compose-dialog {
  width: min(620px, 100%);
  max-height: calc(100dvh - 40px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.compose-header {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
}

.compose-header h2,
.compose-eyebrow {
  margin: 0;
}

.compose-header h2 {
  font-size: 19px;
  line-height: 1.3;
}

.compose-eyebrow {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.compose-form {
  display: grid;
  gap: 15px;
  padding: 18px;
}

.message-field {
  min-height: 190px;
}

.compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 3px;
}

.sent-state {
  min-height: 320px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 14px;
  padding: 30px;
}

.sent-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--success-soft);
  color: var(--success);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .compose-backdrop {
    align-items: end;
    padding: 0;
  }

  .compose-dialog {
    max-height: calc(100dvh - 22px);
    border-radius: 8px 8px 0 0;
  }

  .message-field {
    min-height: 150px;
  }
}
</style>
