import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const cases = [
  { name: 'desktop dark', width: 960, theme: 'dark' },
  { name: 'narrow light', width: 420, theme: 'light' },
] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openWorkbench(page: Page, width: number, theme: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
  );
}

async function customTitleGeometry(page: Page) {
  const root = page.locator('#custom-architecture');
  await root.locator('[data-diagram-step-index="2"]').click();
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  return root.evaluate((element) =>
    [...element.querySelectorAll<SVGTextElement>('.group-label')].map((label) => {
      const group = label.parentElement as SVGGElement;
      const frame = group.querySelector<SVGRectElement>('.group-bg')!.getBoundingClientRect();
      const title = label.getBoundingClientRect();
      const matrix = group.getScreenCTM()!;
      const scaleX = Math.hypot(matrix.a, matrix.c);
      const scaleY = Math.hypot(matrix.b, matrix.d);
      const members = [
        ...group.ownerSVGElement!.querySelectorAll<HTMLElement>('.diagram-node-html'),
      ]
        .map((node) => node.getBoundingClientRect())
        .filter((node) => {
          const x = (node.left + node.right) / 2;
          const y = (node.top + node.bottom) / 2;
          return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
        });
      return {
        top: (title.top - frame.top) / scaleY,
        bottom: (Math.min(...members.map((member) => member.top)) - title.bottom) / scaleY,
        left: (title.left - frame.left) / scaleX,
        right: (frame.right - title.right) / scaleX,
        center: Math.abs((title.left + title.right - frame.left - frame.right) / 2) / scaleX,
      };
    }),
  );
}

async function mermaidTitleGeometry(page: Page) {
  return page.locator('#mermaid-groups').evaluate((element) => {
    const nodes = [...element.querySelectorAll<SVGGElement>('g.node')];
    return [...element.querySelectorAll<SVGGElement>('g.cluster')].map((cluster) => {
      const frame = cluster.querySelector<SVGRectElement>(':scope > rect')!.getBoundingClientRect();
      const title = cluster
        .querySelector<SVGGElement>(':scope > .cluster-label')!
        .getBoundingClientRect();
      const matrix = cluster.getScreenCTM()!;
      const scaleX = Math.hypot(matrix.a, matrix.c);
      const scaleY = Math.hypot(matrix.b, matrix.d);
      const members = nodes
        .map((node) => node.getBoundingClientRect())
        .filter((node) => {
          const x = (node.left + node.right) / 2;
          const y = (node.top + node.bottom) / 2;
          return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
        });
      return {
        top: (title.top - frame.top) / scaleY,
        bottom: (Math.min(...members.map((member) => member.top)) - title.bottom) / scaleY,
        left: (title.left - frame.left) / scaleX,
        right: (frame.right - title.right) / scaleX,
      };
    });
  });
}

for (const item of cases) {
  test(`reserves group title space at ${item.name}`, async ({ page }) => {
    await openWorkbench(page, item.width, item.theme);
    const groups = await customTitleGeometry(page);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.top).toBeGreaterThanOrEqual(13);
      expect(group.bottom).toBeGreaterThanOrEqual(35);
      expect(group.left).toBeGreaterThanOrEqual(23);
      expect(group.right).toBeGreaterThanOrEqual(23);
      expect(group.center).toBeLessThanOrEqual(1);
    }

    const clusters = await mermaidTitleGeometry(page);
    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      expect(cluster.top).toBeGreaterThanOrEqual(19);
      expect(cluster.bottom).toBeGreaterThanOrEqual(31);
      expect(cluster.left).toBeGreaterThanOrEqual(19);
      expect(cluster.right).toBeGreaterThanOrEqual(19);
    }
  });
}
