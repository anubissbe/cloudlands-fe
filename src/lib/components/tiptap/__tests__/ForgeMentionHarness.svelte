<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { ContextMention } from '../ContextMention';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import { installForgeMentionFixture } from '../../../../test/ct-forge-mention-fixture';
  import '$lib/styles/tiptap-editor.css';

  let { theme = 'dark' }: { theme?: 'dark' | 'light' } = $props();
  let element: HTMLDivElement;
  let opened = $state('');
  onMount(() => {
    const cleanupFixture = installForgeMentionFixture((url) => {
      opened = url;
    });
    const editor = new Editor({
      element,
      extensions: [StarterKit, ContextMention],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'contextMention',
                attrs: {
                  provider: 'github',
                  itemType: 'github-pr',
                  identifier: 'euraika/platform/camiel#12',
                  title: 'Complete GitLab integration',
                  url: 'https://git.example:8443/gitlab/euraika/platform/camiel/-/merge_requests/12#note_42',
                  metadata: JSON.stringify({
                    forgeProvider: 'gitlab',
                    sourceBranch: 'feature/gitlab',
                    targetBranch: 'main',
                    author: 'Bert',
                  }),
                },
              },
            ],
          },
        ],
      },
    });
    return () => {
      editor.destroy();
      cleanupFixture();
    };
  });
</script>

<section
  class:dark={theme === 'dark'}
  class="bg-background text-foreground p-6"
  data-testid="forge-context"
>
  <div class="flex items-center gap-2 mb-4">
    <GitHubAvatar identity="Bert" provider="gitlab" size={24} class="rounded-full" alt="Bert" />
    <span>Bert · GitLab</span>
  </div>
  <div bind:this={element} class="tiptap-editor" data-testid="mention-editor"></div>
  <output class="sr-only" data-testid="opened-forge-url">{opened}</output>
</section>
