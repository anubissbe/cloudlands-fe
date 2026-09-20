<script lang="ts">
  import { onDestroy } from 'svelte';
  import { installSourceControlSettingsFixture } from './source-control-settings.fixture';
  import SourceControlSettings from '../SourceControlSettings.svelte';
  let calls = $state<Array<{ method: string; params?: unknown }>>([]);
  let actions = $state<unknown[]>([]);
  const cleanup = installSourceControlSettingsFixture(
    (next) => {
      calls = next;
    },
    (next) => {
      actions = next;
    },
  );
  onDestroy(cleanup);
</script>

<div class="p-6">
  <SourceControlSettings />
  <output class="sr-only" data-testid="rpc-calls">{JSON.stringify(calls)}</output>
  <output class="sr-only" data-testid="redux-actions">{JSON.stringify(actions)}</output>
</div>
