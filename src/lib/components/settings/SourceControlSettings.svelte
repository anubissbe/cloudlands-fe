<script lang="ts">
  import { untrack, onMount } from 'svelte';
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectSourceControlConnections,
    selectSelectedSourceControlConnectionId,
    selectSourceControlBusy,
  } from '$store/renderer/slices/source-control/source-control-selectors';
  import {
    loadSourceControlConnections,
    selectSourceControlConnection,
  } from '$store/renderer/slices/source-control/source-control-slice';
  import type { SourceControlProvider } from '$features/source-control/types';
  import { sourceControlInstanceLabel } from '$features/source-control/utils/presentation';
  import GitHubAuthConnection from './GitHubAuthConnection.svelte';
  import GitLabConnectionSettings from './GitLabConnectionSettings.svelte';

  let {
    initialProvider,
    showProviderPicker = true,
    embedded = false,
    onConnectionReadyChange,
  }: {
    initialProvider?: SourceControlProvider;
    showProviderPicker?: boolean;
    embedded?: boolean;
    onConnectionReadyChange?: (ready: boolean) => void;
  } = $props();
  const connections$ = selectSourceControlConnections();
  const busy$ = selectSourceControlBusy();
  const selectedId$ = selectSelectedSourceControlConnectionId();
  let editingId = $state<string | undefined>(
    untrack(() => (initialProvider === 'gitlab' ? 'gitlab' : undefined)),
  );
  const visibleConnections = $derived(
    initialProvider === 'gitlab'
      ? $connections$.filter((item) => item.provider === 'gitlab')
      : $connections$,
  );
  const connectionId = $derived(
    editingId === 'gitlab'
      ? (visibleConnections.find((item) => item.id === $selectedId$)?.id ??
          visibleConnections.find((item) => item.isConfigured)?.id ??
          visibleConnections[0]?.id ??
          'https://gitlab.com')
      : (editingId ?? $selectedId$),
  );
  const connection = $derived($connections$.find((item) => item.id === connectionId));
  onMount(() => {
    appStore.dispatch(loadSourceControlConnections());
  });
  function handleReady(ready: boolean) {
    if (ready && editingId === 'new') editingId = $selectedId$;
    onConnectionReadyChange?.(ready);
  }
  const schema = defineSettings({
    sections: [
      {
        id: 'source-control-connections',
        get title() {
          return m.settings_sourceControl_title();
        },
        get description() {
          return m.settings_sourceControl_registry_description();
        },
        entries: [
          {
            kind: 'select',
            id: 'source-control-connection',
            get label() {
              return m.settings_sourceControl_connection_label();
            },
            get: () => connectionId,
            set: (value) => {
              editingId = value === 'new' ? 'new' : undefined;
              if (value !== 'new') appStore.dispatch(selectSourceControlConnection(value));
            },
            disabled: () => $busy$,
            get options() {
              const options = visibleConnections.map((item) => ({
                value: item.id,
                label: `${item.provider === 'github' ? 'GitHub' : 'GitLab'} · ${sourceControlInstanceLabel(item.instanceUrl)}${item.user ? ` · @${item.user.login}` : ''}`,
              }));
              return connectionId === 'new'
                ? [...options, { value: 'new', label: m.settings_sourceControl_addGitLab_label() }]
                : options;
            },
            when: () => showProviderPicker || visibleConnections.length > 1,
          },
          {
            kind: 'action',
            id: 'source-control-add-gitlab',
            get label() {
              return m.settings_sourceControl_addGitLab_label();
            },
            get actionLabel() {
              return m.settings_sourceControl_addGitLab_label();
            },
            action: () => {
              editingId = 'new';
            },
            disabled: () => $busy$,
          },
        ],
      },
    ],
  });
</script>

<SettingsForm {schema} {embedded} compact={embedded} />
{#if connectionId === 'https://github.com'}
  <GitHubAuthConnection />
{:else}
  {#key connectionId}
    <GitLabConnectionSettings {connection} {embedded} onConnectionReadyChange={handleReady} />
  {/key}
{/if}
