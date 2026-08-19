<!-- app/pages/confirm.vue -->
<script setup lang="ts">
definePageMeta({ layout: false })

onMounted(async () => {
  await navigateTo('/')
})
</script>

<template>
  <main class="confirm-page">
    <p>Confirming your sign-in...</p>
  </main>
</template>

<style scoped>
.confirm-page { max-width: 360px; margin: 4rem auto; text-align: center; }
</style>
