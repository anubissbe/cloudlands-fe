import { expect, test } from '../../../../test/ct-test';
import SourceControlSettingsHost from './SourceControlSettingsHost.svelte';

test('keeps GitHub and two GitLab servers connected, and disconnects only the addressed server', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 980 });
  const root = await mount(SourceControlSettingsHost);
  await expect(root.getByTestId('source-control-identity')).toContainText('git.euraika.net');
  const token = root.locator('input[type="password"]');
  await token.fill('synthetic-ct-pat');
  await root.getByRole('button', { name: 'Save and test connection', exact: true }).click();
  await expect(root.getByText('Connected as fixture-user', { exact: true })).toBeVisible();
  await expect(token).toHaveValue('');
  await expect(root.getByTestId('redux-actions')).not.toContainText('synthetic-ct-pat');
  await root.locator('input[type="url"]').fill('https://other.example');
  await expect(root.getByText('Connected as fixture-user', { exact: true })).toHaveCount(0);
  await expect(root.getByTestId('source-control-identity').getByRole('status')).toHaveText(
    'Changes not saved',
  );
  await root.locator('input[type="url"]').fill('https://git.euraika.net');
  await root.getByRole('button', { name: 'Add GitLab server', exact: true }).click();
  await root.locator('input[type="url"]').fill('https://git.second.example');
  await token.fill('synthetic-second-pat');
  await root.getByRole('button', { name: 'Save and test connection', exact: true }).click();
  await expect(root.getByText('Connected as second-user', { exact: true })).toBeVisible();
  const picker = root.getByRole('combobox', { name: 'Connection', exact: true });
  await picker.click();
  await page.getByRole('option', { name: /GitLab.*git.euraika.net.*fixture-user/ }).click();
  await expect(root.getByText('Connected as fixture-user', { exact: true })).toBeVisible();
  await root.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(root.getByTestId('source-control-identity').getByRole('status')).toHaveText(
    'Not connected',
  );
  await picker.click();
  await page.getByRole('option', { name: /GitLab.*git.second.example.*second-user/ }).click();
  await expect(root.getByText('Connected as second-user', { exact: true })).toBeVisible();
  await picker.click();
  await page.getByRole('option', { name: /GitHub.*github-user/ }).click();
  await expect(root.getByText('@github-user', { exact: true })).toBeVisible();
  const calls = JSON.parse((await root.getByTestId('rpc-calls').textContent()) ?? '[]');
  expect(
    calls.filter(
      (call: { method: string }) => call.method === 'sourceControl.connections.disconnect',
    ),
  ).toEqual([
    {
      method: 'sourceControl.connections.disconnect',
      params: { connectionId: 'https://git.euraika.net' },
    },
  ]);
  expect(
    calls.filter(
      (call: { method: string }) => call.method === 'sourceControl.connections.configure',
    ),
  ).toHaveLength(2);
  expect(
    calls.some(
      (call: { method: string }) =>
        call.method.startsWith('settings.') || call.method === 'github.revoke',
    ),
  ).toBe(false);
  await expect(root.getByTestId('redux-actions')).not.toContainText('synthetic-second-pat');
});
