<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { installSourceControlSettingsFixture } from './__tests__/source-control-settings.fixture';
  function setup() {
    return installSourceControlSettingsFixture(
      () => {},
      () => {},
    );
  }
  export const preview = definePreview({
    id: 'source-control-settings',
    title: 'GitLab connection',
    defaultState: 'gitlab',
    states: { gitlab: { props: {}, setup } },
  });
</script>

<script lang="ts">
  import SourceControlSettings from './SourceControlSettings.svelte';
</script>

<div class="p-4"><SourceControlSettings /></div>
