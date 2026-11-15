<script setup lang="ts">
// What the hosted viewer's home page, and `serve` before any analysis, show instead of empty views.
const DEMO = 'https://bundle.nuxt.dev/nuxt/nuxt.com/pull/2593?view=compare&base=base&run=pr'
const REPOSITORY = 'https://github.com/atinux/nuxt-bundle-analyzer'

const steps = [
  {
    title: 'Analyze Your App',
    description: 'Run it in a Nuxt project. It builds the app for analysis and opens the analyzer, with nothing to install or configure.',
    commands: ['npx nuxt-bundle-analyzer'],
  },
  {
    title: 'Compare Two Builds',
    description: 'Name a run before and after a change, then open Compare to see the difference for each route, package and file.',
    commands: ['npx nuxt-bundle-analyzer --name=before', 'npx nuxt-bundle-analyzer --name=after'],
  },
  {
    title: 'Compare Pull Requests',
    description: 'GitHub Actions uploads both builds of a pull request here with its OpenID Connect token, so the repository needs no secret, and the bot comment links to the comparison.',
    link: { label: 'Set It Up', to: `${REPOSITORY}#comparisons-on-pull-requests` },
  },
]

const copied = ref<string>()
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = text
  setTimeout(() => {
    if (copied.value === text) {
      copied.value = undefined
    }
  }, 1500)
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl py-8 sm:py-14">
    <Badge label="Experimental" />
    <h2 class="mt-4 text-3xl text-balance text-highlighted sm:text-4xl">
      See What Your Nuxt App Ships
    </h2>
    <p class="mt-3 text-lg text-pretty text-muted">
      Each page with the code it loads before it renders, the chunks your files and dependencies end up in, and how a change or a pull request moves them.
    </p>
    <div class="mt-6 flex flex-wrap gap-3">
      <Button data-variant="solid">
        <template #render="{ props }">
          <a v-bind="props" :href="DEMO">Open a Real Comparison <Icon name="i-lucide-arrow-right" class="size-4" aria-hidden="true" /></a>
        </template>
      </Button>
      <Button>
        <template #render="{ props }">
          <a v-bind="props" :href="REPOSITORY" target="_blank"><Icon name="i-lucide-github" class="size-4" aria-hidden="true" /> GitHub</a>
        </template>
      </Button>
    </div>

    <ol class="mt-12 space-y-8">
      <!-- On phones the text and commands take the full width below the step's number and title. -->
      <li v-for="(step, index) in steps" :key="step.title" class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 sm:gap-x-4">
        <span class="flex size-7 items-center justify-center rounded-full bg-elevated text-sm font-medium text-highlighted ring ring-default">
          {{ index + 1 }}
        </span>
        <h3 class="text-base font-medium text-highlighted">
          {{ step.title }}
        </h3>
        <div class="col-span-2 sm:col-span-1 sm:col-start-2">
          <p class="mt-1 text-sm text-pretty text-muted">
            {{ step.description }}
          </p>
          <div v-for="command in step.commands" :key="command" class="mt-2 flex items-center gap-2 rounded-md bg-elevated/60 py-1 ps-3 pe-1 ring ring-default">
            <code class="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-highlighted sm:text-sm">{{ command }}</code>
            <Button
              :aria-label="copied === command ? 'Copied' : `Copy ${command}`"
              data-variant="ghost"
              class="size-7 p-0"
              @click="copy(command)"
            >
              <Icon :name="copied === command ? 'i-lucide-check' : 'i-lucide-copy'" class="size-4" aria-hidden="true" />
            </Button>
          </div>
          <NuxtLink v-if="step.link" :to="step.link.to" target="_blank" class="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-highlighted">
            {{ step.link.label }}
            <Icon name="i-lucide-arrow-up-right" class="size-4" aria-hidden="true" />
          </NuxtLink>
        </div>
      </li>
    </ol>
  </div>
</template>
