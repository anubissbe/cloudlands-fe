<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CUSTOM_WORKBENCH_CASES,
    DIAGRAM_WORKBENCH_CASES,
  } from './diagram-workbench.preview-fixtures';

  export const preview = definePreview({
    id: 'diagram-controls-host',
    get title() {
      return m.sandbox_diagramWorkbench_review_title();
    },
    defaultState: 'notes',
    captureReadiness: { selector: '[data-diagram-settled="true"]', count: 4 },
    states: { notes: { props: {} } },
  });
</script>

<script lang="ts">
  import DiagramPresentation from './DiagramPresentation.svelte';
  import DiagramRenderer from './DiagramRenderer.svelte';
  import NoteDiagramControlsBand from './NoteDiagramControlsBand.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';

  let ports = $state<HTMLElement[]>([]);
  let enabled = $state(true);
  let mounted = $state(true);
  let note = $state(0);
  const diagrams = [
    CUSTOM_WORKBENCH_CASES['custom-architecture'],
    CUSTOM_WORKBENCH_CASES['custom-delivery-walkthrough'],
  ];
</script>

<!-- i18n-ignore (deterministic preview-only lifecycle controls) -->
<div class="flex gap-3 mb-3">
  <button onclick={() => (enabled = !enabled)} data-testid="toggle-band">Toggle editor view</button>
  <button onclick={() => (note += 1)} data-testid="switch-note">Switch note</button>
  <button onclick={() => (mounted = !mounted)} data-testid="toggle-mount">Toggle host</button>
</div>

<div class="hosts">
  {#each [0, 1] as index}
    {#if mounted || index === 1}
      <article class="note-host" data-testid={`note-host-${index}`}>
        <section class="note-content-container" bind:this={ports[index]}>
          <div class="lead" data-testid="lead"></div>
          {#key index === 0 ? note : 0}
            <div class="tiptap-editor ProseMirror" contenteditable="false">
              {#each diagrams as fixture, diagramIndex}
                {#if fixture.kind === 'custom' && (index === 1 || note % 3 === 0)}
                  <div class="node-diagram_block" data-testid={`walkthrough-${diagramIndex}`}>
                    <DiagramPresentation kind="custom">
                      <DiagramRenderer diagram={fixture.diagram} editable={false} />
                    </DiagramPresentation>
                  </div>
                {/if}
              {/each}
              {#if index === 0 && note % 3 === 2}
                <DiagramRenderer diagram={CUSTOM_WORKBENCH_CASES['custom-flowchart'].diagram} />
                {@const mermaid = DIAGRAM_WORKBENCH_CASES['mermaid-flow']}
                {#if mermaid.kind === 'mermaid'}
                  <MermaidRenderer code={mermaid.source} />
                {/if}
              {/if}
            </div>
          {/key}
          <div class="tail" data-testid="tail"></div>
        </section>
        <NoteDiagramControlsBand
          scrollport={ports[index]}
          scopeKey={String(index === 0 ? note : 0)}
          enabled={index === 1 || enabled}
        />
      </article>
    {/if}
  {/each}
</div>

<style>
  .hosts {
    display: grid;
    gap: 24px;
  }
  .note-host {
    display: flex;
    flex-direction: column;
    height: 560px;
    min-width: 0;
    overflow: hidden;
    background: hsl(var(--background));
  }
  .note-content-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
    container-type: inline-size;
  }
  .tiptap-editor {
    height: auto;
    min-height: 0;
  }
  .lead {
    height: 700px;
  }
  .tail {
    height: 900px;
  }
</style>
