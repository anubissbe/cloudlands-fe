<script lang="ts">
  import GithubLogoIcon from 'phosphor-svelte/lib/GithubLogoIcon';
  import GitlabLogoIcon from 'phosphor-svelte/lib/GitlabLogoIcon';
  import type { SourceControlProvider } from './types';

  let {
    provider,
    size = 16,
    class: className = '',
  }: { provider: SourceControlProvider; size?: number; class?: string } = $props();
</script>

{#if provider === 'gitlab'}
  <GitlabLogoIcon {size} weight="fill" class={className} aria-hidden="true" />
{:else}
  <GithubLogoIcon {size} weight="fill" class={className} aria-hidden="true" />
{/if}
