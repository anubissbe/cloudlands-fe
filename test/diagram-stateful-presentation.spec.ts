import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';

// The prose host and narrow host are separate width contracts; color is unchanged.
for (const width of [960, 420]) {
  test(`stateful note uses its lane and retains keyboard and export actions · ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      `${baseUrl}/sandbox/diagram-embedding?state=note&theme=light&width=${width}&motion=reduced`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('Escape');
    const root = page.locator('[data-preview-note-diagram] .diagram-renderer');
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const lane = await root.evaluate((element) => {
      const host = element.closest('[data-preview-note-diagram]')!.getBoundingClientRect();
      const presentation = element.closest('[data-diagram-presentation]')!.getBoundingClientRect();
      return {
        host: host.width,
        presentation: presentation.width,
        left: presentation.left - host.left,
        right: host.right - presentation.right,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(lane.presentation).toBeCloseTo(lane.host, 0);
    expect(lane.left).toBeGreaterThanOrEqual(-1);
    expect(lane.right).toBeGreaterThanOrEqual(-1);
    expect(lane.pageOverflow).toBeLessThanOrEqual(1);
    const initial = root.locator('[data-diagram-step-index="0"]');
    await initial.focus();
    await page.keyboard.press('End');
    await expect(root).toHaveAttribute('data-diagram-state', 'observe');
    await expect(root.locator('[data-diagram-step-index="2"]')).toBeFocused();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await page.keyboard.press('Home');
    await expect(root).toHaveAttribute('data-diagram-state', 'orient');
    await expect(initial).toBeFocused();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await root.screenshot({ path: testInfo.outputPath('note-initial.png') });
    await page.getByRole('button', { name: 'Diagram actions', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download SVG', exact: true }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toMatch(/\.svg$/);
    expect(await exported.failure()).toBeNull();
    await testInfo.attach('note-lane', {
      body: JSON.stringify(lane),
      contentType: 'application/json',
    });
  });
}
