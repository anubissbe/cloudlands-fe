import { expect, test } from '@playwright/experimental-ct-svelte';
import type { ConnectionRecord } from '$shared/types/connections';
import DeviceRow from '../DeviceRow.svelte';
import Preview from '../devices-settings.preview.svelte';

const device: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  accent: 'indigo',
  host: '10.0.0.2',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
  status: 'not-open',
};

test('keeps edit fields and controls contained at narrow width', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const component = await mount(DeviceRow, {
    props: {
      device,
      panelMode: 'edit',
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onRequestRemove: () => {},
    },
  });
  const form = component.getByRole('form', { name: 'Edit Studio Mac' });
  const formBox = await form.boundingBox();
  expect(formBox).not.toBeNull();

  const controls = ['Test connection', 'Cancel', 'Update'].map((name) =>
    form.getByRole('button', { name }),
  );
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(formBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);
  }
  for (const name of ['Name', 'Hostname or IP', 'Port']) {
    const inputBox = await form.getByRole('textbox', { name, exact: true }).boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);
  }
});

for (const width of [360, 1024]) {
  test(`local configuration stays contained at the ${width < 768 ? 'stacked' : 'two-column'} settings breakpoint`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, {
      props: { expanded: true },
      hooksConfig: { geometrySnapshot: { scene: 'devices-settings', state: 'local-expanded' } },
    });
    const local = page.getByRole('article', { name: 'This machine (local)' });
    await expect(local.getByRole('button', { name: 'Show QR Code' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const overflowing = await local.evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return [...row.querySelectorAll('button, input, code')]
        .filter((node) => node.getClientRects().length > 0)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        })
        .map((node) => node.getAttribute('aria-label') ?? node.textContent);
    });
    expect(overflowing).toEqual([]);
    await local.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(local.getByRole('spinbutton', { name: 'Port' })).toHaveCount(0);
    const actions = local.getByRole('button', { name: 'Actions for This machine (local)' });
    await expect(actions).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(local.getByTestId('device-icon-picker-trigger')).toBeVisible();
    await expect(local.getByRole('spinbutton', { name: 'Port' })).toHaveValue('5181');
  });
}
