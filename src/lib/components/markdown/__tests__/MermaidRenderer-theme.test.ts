import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-roledescription="sequence"></svg>' })),
}));

vi.mock('mermaid', () => ({ default: mermaidMocks }));
vi.mock('mermaid-layout-elk', () => ({ default: vi.fn() }));

import MermaidRenderer from '../MermaidRenderer.svelte';

const tokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--diagram-canvas': 'hsl(0 0% 100%)',
  '--diagram-node-surface': 'hsl(0 0% 96%)',
  '--diagram-connector': 'rgb(118 124 132)',
  '--font-ui': 'Inter, system-ui, sans-serif',
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

describe('MermaidRenderer theme updates', () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  });

  afterEach(() => {
    cleanup();
    for (const name of Object.keys(tokens)) {
      document.documentElement.style.removeProperty(name);
    }
  });

  it('rerenders with current tokens when a custom theme changes root styles', async () => {
    const result = render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());
    expect(result.container.querySelector('svg[aria-roledescription="sequence"]')).toBeTruthy();

    document.documentElement.style.setProperty('--diagram-node-surface', '260 20% 18%');

    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledTimes(2));
    const latestConfig = mermaidMocks.initialize.mock.calls.at(-1)?.[0];
    expect(latestConfig.themeVariables.primaryColor).toBe('hsl(260 20% 18%)');
  });

  it('keeps class diagrams on SVG labels for geometry repair', async () => {
    render(MermaidRenderer, { code: 'classDiagram\n  class PreviewDefinition' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());
    expect(mermaidMocks.initialize.mock.calls[0]?.[0].htmlLabels).toBe(false);
  });

  it('defaults state diagrams to a vertical topology without overriding an explicit one', async () => {
    const { rerender } = render(MermaidRenderer, {
      code: 'stateDiagram-v2\n  [*] --> Idle',
    });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledOnce());
    expect(mermaidMocks.render.mock.calls[0]?.[1]).toContain('direction TB');
    expect(mermaidMocks.initialize.mock.calls[0]?.[0]).toMatchObject({ layout: 'elk' });

    await rerender({ code: 'stateDiagram-v2\n  direction RL\n  [*] --> Idle' });
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledTimes(2));
    expect(mermaidMocks.render.mock.calls[1]?.[1]).toContain('direction RL');
    expect(mermaidMocks.render.mock.calls[1]?.[1].match(/direction\s+/g)).toHaveLength(1);
    expect(mermaidMocks.initialize.mock.calls[1]?.[0]).toMatchObject({ layout: 'elk' });
  });

  it('measures and presents diagrams with the application UI typography', async () => {
    render(MermaidRenderer, { code: 'sequenceDiagram\nA->>B: Ready' });
    await waitFor(() => expect(mermaidMocks.initialize).toHaveBeenCalledOnce());

    expect(mermaidMocks.initialize.mock.calls[0]?.[0]).toMatchObject({
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 13,
    });
  });

  it('joins automatic note wraps without removing authored line breaks or tspan text', async () => {
    const getBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
    const viewBox = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'viewBox');
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value(this: SVGElement) {
        if (this.tagName.toLowerCase() === 'text') {
          const width = (this.textContent?.length ?? 0) * 6;
          return {
            x: Number(this.getAttribute('x')) - width / 2,
            y: Number(this.getAttribute('y')) - 10,
            width,
            height: 12,
          };
        }
        return { x: 0, y: 0, width: 300, height: 180 };
      },
    });
    Object.defineProperty(SVGSVGElement.prototype, 'viewBox', {
      configurable: true,
      get() {
        return { baseVal: { x: 0, y: 0, width: 300, height: 180 } };
      },
    });
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mermaidMocks.render.mockResolvedValueOnce({
      svg: `<svg aria-roledescription="sequence" viewBox="0 0 300 180">
        <g id="automatic"><rect class="note"/><text class="noteText" x="100" y="50"><tspan x="100">Shared </tspan><tspan>browser</tspan></text><text class="noteText" x="100" y="65"><tspan x="100">rendering boundary</tspan></text></g>
        <g id="authored"><rect class="note"/><text class="noteText" x="200" y="100"><tspan x="200">First authored</tspan></text><text class="noteText" x="200" y="115"><tspan x="200">line</tspan></text><text class="noteText" x="200" y="130"><tspan x="200">Second authored line</tspan></text></g>
      </svg>`,
    });

    try {
      const result = render(MermaidRenderer, {
        code: 'sequenceDiagram\n  participant A\n  participant B\n  Note over A,B: Shared browser rendering boundary\n  Note over A,B: First authored line<br/>Second authored line',
      });
      await waitFor(() =>
        expect(result.container.querySelector('.mermaid-renderer')?.dataset.renderSettled).toBe(
          'true',
        ),
      );

      const automatic = result.container.querySelector('#automatic')!;
      const authored = result.container.querySelector('#authored')!;
      expect(automatic.querySelectorAll('text.noteText')).toHaveLength(1);
      expect(automatic.querySelector('text.noteText')?.textContent).toBe(
        'Shared browser rendering boundary',
      );
      expect(automatic.querySelectorAll('text.noteText tspan')).toHaveLength(1);
      expect(
        [...authored.querySelectorAll('text.noteText')].map((text) => text.textContent),
      ).toEqual(['First authored line', 'Second authored line']);
      expect(authored.querySelectorAll('text.noteText tspan')).toHaveLength(2);
    } finally {
      canvas.mockRestore();
      if (getBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', getBBox);
      else delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox;
      if (viewBox) Object.defineProperty(SVGSVGElement.prototype, 'viewBox', viewBox);
      else delete (SVGSVGElement.prototype as SVGSVGElement & { viewBox?: unknown }).viewBox;
    }
  });
});
