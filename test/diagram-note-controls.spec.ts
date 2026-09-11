import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';

async function openHost(page: Page, width = 960) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-controls-host?state=notes&theme=light&width=${width}&motion=reduced`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts.ready);
  return page.getByTestId('note-host-0');
}

async function position(host: Locator, diagram: number, top: number) {
  return host.evaluate(
    async (element, { diagram, top }) => {
      const port = element.querySelector<HTMLElement>('.note-content-container')!;
      const root = element.querySelector(
        `[data-testid="walkthrough-${diagram}"] .diagram-renderer`,
      )!;
      port.scrollTop += root.getBoundingClientRect().top - port.getBoundingClientRect().top - top;
      const requested = port.scrollTop;
      const samples = [];
      for (let index = 0; index < 12; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const band = element.querySelector<HTMLElement>('[data-note-diagram-band]')!;
        const p = port.getBoundingClientRect(),
          b = band.getBoundingClientRect();
        samples.push({
          scroll: port.scrollTop,
          reserved: !band.hidden,
          gap: b.top - p.bottom,
          controls: band.querySelectorAll('.diagram-controls').length,
        });
      }
      return { requested, samples };
    },
    { diagram, top },
  );
}

for (const width of [960, 420]) {
  test(`note band reserves space through entry, long scene and exit · ${width}`, async ({
    page,
  }, testInfo) => {
    const host = await openHost(page, width);
    const band = host.locator('[data-note-diagram-band]');
    await expect(band).toBeHidden();
    const entry = await position(host, 0, 380);
    expect(entry.samples.slice(3).every((sample) => sample.reserved && sample.gap >= -1)).toBe(
      true,
    );
    expect(entry.samples.every((sample) => sample.scroll === entry.requested)).toBe(true);
    await expect(host.locator('.note-content-container .diagram-controls:visible')).toHaveCount(0);
    await expect(band.locator('.diagram-controls')).toHaveCount(1);
    const middle = await position(host, 0, 30);
    expect(middle.samples.every((sample) => sample.scroll === middle.requested)).toBe(true);
    await band.locator('[data-diagram-step-index="2"]').click();
    const architecture = host.getByTestId('walkthrough-0').locator('.diagram-renderer');
    await expect(architecture).toHaveAttribute('data-diagram-state', 'observe');
    await expect(architecture).toHaveAttribute('data-diagram-settled', 'true');
    await position(host, 1, 10);
    const delivery = host.getByTestId('walkthrough-1').locator('.diagram-renderer');
    await expect(delivery).toHaveAttribute('data-controls-in-note-band', 'true');
    await band.locator('[data-diagram-step-index="3"]').click();
    await expect(delivery).toHaveAttribute('data-diagram-state', 'observe');
    await expect(delivery).toHaveAttribute('data-diagram-settled', 'true');
    await host.screenshot({ path: testInfo.outputPath('reserved-band.png') });
    const long = await position(host, 1, -150);
    expect(long.samples.slice(3).every((sample) => sample.reserved && sample.gap >= -1)).toBe(true);
    await host.locator('.note-content-container').evaluate((port) => {
      port.scrollTop = port.scrollHeight;
    });
    await expect(band).toBeHidden();
    await expect(host.locator('[data-controls-in-note-band]')).toHaveCount(0);
    const exit = await host.locator('.note-content-container').evaluate((port) => port.scrollTop);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await host.locator('.note-content-container').evaluate((port) => port.scrollTop)).toBe(
      exit,
    );
    await testInfo.attach('scroll-geometry', {
      body: JSON.stringify({ entry, middle, long }),
      contentType: 'application/json',
    });
  });
}

test('portaled controls keep one focus target and drive only their owning note', async ({
  page,
}) => {
  const host = await openHost(page);
  const other = page.getByTestId('note-host-1');
  const footer = await host.getByTestId('walkthrough-0').locator('.diagram-footer').elementHandle();
  await position(host, 0, 30);
  await position(other, 0, 30);
  const band = host.locator('[data-note-diagram-band]');
  expect(
    await band.evaluate((element, footer) => element.firstElementChild === footer, footer),
  ).toBe(true);
  await band.locator('[data-diagram-step-index="0"]').focus();
  const before = await host.locator('.note-content-container').evaluate((port) => port.scrollTop);
  await page.keyboard.press('End');
  await expect(band.locator('[data-diagram-step-index="2"]')).toBeFocused();
  await expect(host.getByTestId('walkthrough-0').locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-state',
    'observe',
  );
  await expect(other.getByTestId('walkthrough-0').locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-state',
    'orient',
  );
  await page.keyboard.press('Home');
  await expect(band.locator('[data-diagram-step-index="0"]')).toBeFocused();
  expect(await host.locator('.note-content-container').evaluate((port) => port.scrollTop)).toBe(
    before,
  );
  await position(host, 0, -30);
  await expect(band.locator('[data-diagram-step-index="0"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(band.getByRole('button', { name: 'Next step', exact: true })).toBeFocused();
  const port = host.locator('.note-content-container');
  await port.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(band).toBeHidden();
  await expect(port).toBeFocused();
  expect(await port.evaluate((element) => element.scrollTop)).toBe(0);
});

test('two visible walkthroughs have stable explicit ownership without duplicated controls', async ({
  page,
}) => {
  const host = await openHost(page);
  await position(host, 1, 300);
  const first = host.getByTestId('walkthrough-0').locator('.diagram-renderer');
  const second = host.getByTestId('walkthrough-1').locator('.diagram-renderer');
  await expect(first).toHaveAttribute('data-controls-in-note-band', 'true');
  await second.locator('.diagram-scroll-container').dispatchEvent('pointerdown');
  await expect(second).toHaveAttribute('data-controls-in-note-band', 'true');
  await expect(first).not.toHaveAttribute('data-controls-in-note-band', 'true');
  const samples = await position(host, 1, 300);
  expect(
    samples.samples.every((sample) => sample.controls === 1 && sample.scroll === samples.requested),
  ).toBe(true);
  await expect(second).toHaveAttribute('data-controls-in-note-band', 'true');
  await host.locator('[data-note-diagram-band] [data-diagram-step-index="1"]').click();
  await expect(second).toHaveAttribute('data-diagram-state', 'verify');
  await expect(first).toHaveAttribute('data-diagram-state', 'orient');
});

test('view changes, prose note replacement and unmount release controls without cross-host leakage', async ({
  page,
}) => {
  const host = await openHost(page);
  const other = page.getByTestId('note-host-1');
  await position(host, 0, 30);
  await position(other, 0, 30);
  const band = host.locator('[data-note-diagram-band]');
  await page.getByTestId('toggle-band').click();
  await expect(band).toBeHidden();
  await expect(host.getByTestId('walkthrough-0').locator('.diagram-footer')).toHaveCount(1);
  await page.getByTestId('toggle-band').click();
  await expect(band).toBeVisible();
  await page.getByTestId('switch-note').click();
  await expect(band).toBeHidden();
  await expect(host.locator('.diagram-controls')).toHaveCount(0);
  await expect(other.locator('[data-note-diagram-band] .diagram-controls')).toHaveCount(1);
  await page.getByTestId('switch-note').click();
  await expect(host.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  await expect(host.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
  await host.locator('.note-content-container').evaluate((port) => {
    port.scrollTop = 700;
  });
  await expect(band).toBeHidden();
  await expect(host.locator('.diagram-controls')).toHaveCount(0);
  await page.getByTestId('switch-note').click();
  await position(host, 0, 30);
  await expect(band).toBeVisible();
  await page.getByTestId('toggle-mount').click();
  await expect(host).toHaveCount(0);
  await expect(page.locator('[data-note-diagram-band] .diagram-controls')).toHaveCount(1);
});
