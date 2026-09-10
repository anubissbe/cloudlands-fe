import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openState(page: Page, state: string) {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
}

async function mermaidGeometry(page: Page, state: string) {
  return page.locator(`#${state}`).evaluate((root) => {
    const renderer = root.querySelector<HTMLElement>('.mermaid-renderer')!;
    const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport')!;
    const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
    const viewportBounds = viewport.getBoundingClientRect();
    const painted = [
      ...svg.querySelectorAll<SVGGraphicsElement>(
        'g.node, .edgePaths path, .edgeLabels > .edgeLabel',
      ),
    ]
      .filter((element) => Number(getComputedStyle(element).opacity) > 0)
      .map((element) => element.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 || bounds.height > 0);
    const svgBounds = svg.getBoundingClientRect();
    return {
      generation: Number(renderer.dataset.renderGeneration),
      settled: renderer.dataset.renderSettled,
      layoutSettled: svg.dataset.layoutSettled,
      viewBox: svg.getAttribute('viewBox'),
      svgSize: [svgBounds.width, svgBounds.height],
      scrollSize: [viewport.scrollWidth, viewport.scrollHeight],
      contained: painted.every(
        (bounds) =>
          bounds.left >= viewportBounds.left - 1 &&
          bounds.right <= viewportBounds.right + 1 &&
          bounds.top >= viewportBounds.top - 1 &&
          bounds.bottom <= viewportBounds.bottom + 1,
      ),
    };
  });
}

test('keeps settled Mermaid geometry stable through unrelated root styles and panel resizes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const state = 'mermaid-cycle-fanout';
  await openState(page, state);
  const initial = await mermaidGeometry(page, state);

  await page.evaluate(async () => {
    for (const height of [36, 48, 24, 40]) {
      document.documentElement.style.setProperty('--terminal-overlay-height', `${height}px`);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  });
  await page.waitForTimeout(300);
  expect(await mermaidGeometry(page, state)).toEqual(initial);

  for (const width of [420, 960]) {
    const previousGeneration = Number(
      await page.locator(`#${state} .mermaid-renderer`).getAttribute('data-render-generation'),
    );
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await expect
      .poll(() => mermaidGeometry(page, state), { timeout: 30_000 })
      .toMatchObject({
        generation: expect.any(Number),
        settled: 'true',
        layoutSettled: 'true',
        contained: true,
      });
    await expect
      .poll(
        async () =>
          Number(
            await page
              .locator(`#${state} .mermaid-renderer`)
              .getAttribute('data-render-generation'),
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(previousGeneration);
    await expect(page.locator(`#${state} .mermaid-renderer`)).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(JSON.stringify(await mermaidGeometry(page, state)));
      await page.waitForTimeout(100);
    }
    expect(new Set(samples).size, `${width}px settled Mermaid geometry`).toBe(1);
  }
});

test('keeps the final architecture step contained and stable through panel resizes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const state = 'custom-architecture';
  await openState(page, state);
  const root = page.locator(`#${state}`);
  await root.getByRole('button', { name: 'State 3: 3. Close the loop' }).click();
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');

  for (const width of [420, 960]) {
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await page.waitForTimeout(300);
    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(
        JSON.stringify(
          await root.evaluate((section) => {
            const renderer = section.querySelector<HTMLElement>('.diagram-renderer')!;
            const viewport = section.querySelector<HTMLElement>('.diagram-scroll-container')!;
            const svg = section.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
            const viewportBounds = viewport.getBoundingClientRect();
            const painted = [
              ...section.querySelectorAll<SVGGraphicsElement>(
                '[data-node-id], [data-group-id] .group-bg, .edge-path, .edge-label-container',
              ),
            ]
              .filter((element) => Number(getComputedStyle(element).opacity) > 0)
              .map((element) => element.getBoundingClientRect())
              .filter((bounds) => bounds.width > 0 || bounds.height > 0);
            return {
              state: renderer.dataset.diagramState,
              settled: renderer.dataset.diagramSettled,
              viewBox: svg.getAttribute('viewBox'),
              svgSize: [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height],
              scrollSize: [viewport.scrollWidth, viewport.scrollHeight],
              minFontSize: Math.min(
                ...[...section.querySelectorAll<HTMLElement>('.node-label')].map((label) =>
                  Number.parseFloat(getComputedStyle(label).fontSize),
                ),
              ),
              contained: painted.every(
                (bounds) =>
                  bounds.left >= viewportBounds.left - 1 &&
                  bounds.right <= viewportBounds.right + 1 &&
                  bounds.top >= viewportBounds.top - 1 &&
                  bounds.bottom <= viewportBounds.bottom + 1,
              ),
            };
          }),
        ),
      );
      await page.waitForTimeout(100);
    }
    expect(new Set(samples).size, `${width}px settled architecture geometry`).toBe(1);
    const result = JSON.parse(samples[0]);
    expect(result).toMatchObject({
      state: 'observe',
      settled: 'true',
      contained: true,
    });
    expect(result.minFontSize, `${width}px readable architecture text`).toBeGreaterThanOrEqual(12);
  }
});
