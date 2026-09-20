<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectSourceControlConnections,
    selectSelectedSourceControlConnectionId,
  } from '$store/renderer/slices/source-control/source-control-selectors';
  import { selectSourceControlConnection } from '$store/renderer/slices/source-control/source-control-slice';
  import SourceControlIcon from './SourceControlIcon.svelte';
  import { sourceControlInstanceLabel } from './utils/presentation';
  const connections$ = selectSourceControlConnections();
  const selectedId$ = selectSelectedSourceControlConnectionId();
  const selected = $derived($connections$.find((connection) => connection.id === $selectedId$));
</script>

<Select.Root
  value={$selectedId$}
  onchange={(id) => appStore.dispatch(selectSourceControlConnection(id))}
>
  <Select.Trigger aria-label={m.settings_sourceControl_connection_label()} class="w-full">
    {#if selected}<SourceControlIcon provider={selected.provider} />{/if}
    <span class="truncate"
      >{selected
        ? sourceControlInstanceLabel(selected.instanceUrl)
        : m.settings_sourceControl_connection_label()}</span
    >
  </Select.Trigger>
  <Select.Content portal>
    {#each $connections$ as connection (connection.id)}
      <Select.Item value={connection.id}>
        <SourceControlIcon provider={connection.provider} />
        <span>{sourceControlInstanceLabel(connection.instanceUrl)}</span>
        {#if connection.user}<span class="text-muted-foreground">@{connection.user.login}</span
          >{/if}
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
