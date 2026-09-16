<script lang="ts">
  import MermaidRenderer from '../MermaidRenderer.svelte';
  import { MERMAID_WORKBENCH_CASES } from '../../diagrams/diagram-workbench.preview-fixtures';

  let { theme = 'dark', htmlLabels = true }: { theme?: 'light' | 'dark'; htmlLabels?: boolean } =
    $props();
  // Representative existing fixture, not the unavailable user @test source.
  const source = [
    MERMAID_WORKBENCH_CASES['mermaid-nested-groups'].source,
    'style Client fill:#dbeafe',
    'style Gateway fill:#dcfce7',
    'style Outer fill:#fef3c7',
    'style Inner fill:transparent,color:#123456',
    'classDef darkChild fill:#172554,color:#ffffff',
    'class Queue,Worker darkChild',
    'style Store fill:none,color:#eeeeee',
  ].join('\n');
  const code = $derived(`---\nconfig:\n  htmlLabels: ${htmlLabels}\n---\n${source}`);

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });
</script>

<div style="width:960px" data-theme={theme}>
  <MermaidRenderer {code} showSourceButton={false} showExpandButton={false} />
</div>
