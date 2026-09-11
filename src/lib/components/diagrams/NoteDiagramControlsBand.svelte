<script lang="ts">
  import { createNoteDiagramControlsHost } from './note-diagram-controls';

  let {
    scrollport,
    scopeKey,
    enabled = true,
  }: {
    scrollport?: HTMLElement;
    scopeKey?: string;
    enabled?: boolean;
  } = $props();
  let band = $state<HTMLDivElement>();

  $effect(() => {
    // Reset ownership on identity changes, including when the host is reused.
    // The note host disables the band until its new editor content is ready.
    void scopeKey;
    if (!scrollport || !band) return;
    if (enabled) return createNoteDiagramControlsHost(scrollport, band);
  });
</script>

<div bind:this={band} class="note-diagram-controls-band" data-note-diagram-band hidden></div>

<style>
  .note-diagram-controls-band {
    flex: none;
    min-width: 0;
    display: grid;
    justify-items: center;
    background: hsl(var(--card));
    font-family: var(--font-ui);
  }

  .note-diagram-controls-band[hidden] {
    display: none;
  }

  .note-diagram-controls-band :global(.diagram-footer) {
    position: static;
    max-width: 100%;
    overflow: visible;
    grid-row: auto;
  }

  .note-diagram-controls-band :global(.controls-inner) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  :global([data-diagram-controls-host] .diagram-footer) {
    position: static;
    visibility: hidden;
  }

  :global([data-diagram-controls-host] .diagram-controls-slot) {
    display: block;
  }
</style>
