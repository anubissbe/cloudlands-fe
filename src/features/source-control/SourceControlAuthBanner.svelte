<script lang="ts">
  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import { Button } from '$lib/components/ui/button';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
    selectSourceControlConnections,
    selectSourceControlSettings,
  } from '$store/renderer/slices/source-control/source-control-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import SourceControlIcon from './SourceControlIcon.svelte';
  import { sourceControlInstanceLabel } from './utils/presentation';

  let {
    message,
    onSuccess,
    autoStart = false,
    connectionId,
    class: className = '',
  }: {
    message?: string;
    onSuccess?: () => void;
    autoStart?: boolean;
    connectionId?: string;
    class?: string;
  } = $props();
  const settings$ = selectSourceControlSettings();
  const connections$ = selectSourceControlConnections();
  const connection = $derived(
    $connections$.find((item) => item.id === connectionId) ??
      (connectionId
        ? {
            provider: connectionId === 'https://github.com' ? 'github' : 'gitlab',
            instanceUrl: connectionId,
          }
        : $settings$),
  );
</script>

{#if connection.provider === 'gitlab'}
  <div class={`flex flex-wrap items-center gap-3 py-3 ${className}`}>
    <SourceControlIcon provider="gitlab" size={24} class="shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1 space-y-1">
      <p class="type-body font-medium text-foreground">
        {m.settings_sourceControl_connectProvider_label({ provider: 'GitLab' })}
      </p>
      <p class="type-caption truncate text-muted-foreground">
        {sourceControlInstanceLabel(connection.instanceUrl)}
      </p>
      <p class="type-body text-muted-foreground">
        {message ?? m.settings_sourceControl_gitlabConnect_description()}
      </p>
    </div>
    <Button
      variant="secondary"
      size="sm"
      onclick={() => navigateToSettings({ tab: 'connections' })}
    >
      {m.settings_sourceControl_openSettings_label()}
    </Button>
  </div>
{:else}
  <GitHubAuthBanner {message} {onSuccess} {autoStart} class={className} />
{/if}
