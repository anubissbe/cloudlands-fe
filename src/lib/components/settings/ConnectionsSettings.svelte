<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { initializeLinearAuth } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import { initializeSentryAuth } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';
  import SourceControlIcon from '$features/source-control/SourceControlIcon.svelte';
  import { selectSourceControlSettings } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import SourceControlSettings from './SourceControlSettings.svelte';
  import LinearAuthConnection from './LinearAuthConnection.svelte';
  import SentryAuthConnection from './SentryAuthConnection.svelte';

  // Track if initial load is complete
  let isLoading = $state(true);
  const sourceControl$ = selectSourceControlSettings();

  // Integration metadata for skeleton rendering.
  const integrations = [
    {
      icon: 'source-control',
      name: m.settings_sourceControl_title(),
      description: m.settings_sourceControl_description(),
    },
    {
      icon: 'linear',
      name: 'Linear',
      description: m.settings_connections_linear_description(),
    },
    { icon: 'sentry', name: 'Sentry', description: m.settings_connections_sentry_description() },
  ] as const;

  onMount(() => {
    // Initialize all stores in parallel
    appStore.dispatch(initializeGitHubAuth());
    appStore.dispatch(initializeLinearAuth());
    appStore.dispatch(initializeSentryAuth());
    isLoading = false;
  });
</script>

{#if isLoading}
  <!-- Skeleton loading state - shows structure with known info -->
  <div class="divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
    {#each integrations as integration}
      <div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3">
        <div class="flex size-4 items-center justify-center text-ghost">
          {#if integration.icon === 'source-control'}
            <SourceControlIcon provider={$sourceControl$.provider} />
          {:else if integration.icon === 'linear'}
            <LinearIcon size={16} />
          {:else if integration.icon === 'sentry'}
            <SentryIcon size={16} />
          {/if}
        </div>
        <div class="flex min-w-0 items-center gap-3">
          <span class="type-body font-medium text-foreground">{integration.name}</span>
          <div class="h-3 w-16 animate-pulse rounded bg-muted/50"></div>
        </div>
        <!-- Action button skeleton -->
        <div class="mt-1 h-4 w-14 animate-pulse rounded bg-muted/50"></div>
        <p class="type-body col-start-2 text-muted-foreground">{integration.description}</p>
      </div>
    {/each}
  </div>
{:else}
  <div class="divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
    <SourceControlSettings />
    <LinearAuthConnection />
    <SentryAuthConnection />
  </div>
{/if}
