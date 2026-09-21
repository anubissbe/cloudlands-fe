import { expect, test } from '../../../test/ct-test';
import GitlabOnboardingHost from './GitlabOnboardingHost.svelte';

test('onboarding adds a second GitLab connection alongside GitHub and browses the selected server', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const root = await mount(GitlabOnboardingHost);
  const github = root.getByRole('button', { name: 'GitHub', exact: true });
  const gitlab = root.getByRole('button', { name: 'GitLab', exact: true });
  await expect(github).toHaveAttribute('aria-pressed', 'true');
  await gitlab.focus();
  await gitlab.press('Enter');
  await expect(gitlab).toHaveAttribute('aria-pressed', 'true');
  const instance = root.locator('input[type="url"]');
  await instance.fill('https://git.euraika.net');
  await root.screenshot({ path: testInfo.outputPath('onboarding-gitlab-connection.png') });
  await root.locator('input[type="password"]').fill('synthetic-onboarding-pat');
  await root.getByRole('button', { name: 'Connect GitLab', exact: true }).click();
  await expect(root.getByText('Connected as camiel-user', { exact: true })).toBeVisible();
  const continueButton = root.getByRole('button', { name: /^Continue/ });
  await instance.fill('https://another-instance.example');
  await expect(continueButton).toBeDisabled();
  await instance.fill('https://git.euraika.net');
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await root.getByRole('button', { name: /GitLab/ }).click();

  const project = root.getByRole('option').filter({ hasText: 'camiel' });
  await expect(project).toBeVisible();
  await root.screenshot({ path: testInfo.outputPath('onboarding-gitlab-projects.png') });
  const input = root.locator('input').first();
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect
    .poll(async () =>
      JSON.parse((await root.getByTestId('onboarding-selection').textContent()) ?? '{}'),
    )
    .toEqual({
      selection: {
        type: 'github',
        repoPath: 'euraika/platform/camiel',
        branch: '',
        githubUrl: 'https://git.euraika.net/euraika/platform/camiel',
        projectName: 'camiel',
        isValid: true,
      },
      advanced: true,
    });
  const calls = JSON.parse(
    (await root.getByTestId('onboarding-rpc-calls').textContent()) ?? '[]',
  ) as Array<{ method: string; params?: unknown }>;
  expect(calls.find((call) => call.method === 'sourceControl.connections.configure')).toEqual({
    method: 'sourceControl.connections.configure',
    params: {
      provider: 'gitlab',
      instanceUrl: 'https://git.euraika.net',
      tokenSource: 'explicit',
      token: '[redacted]',
    },
  });
  expect(calls.filter((call) => call.method === 'sourceControl.repos.list')).toEqual([
    {
      method: 'sourceControl.repos.list',
      params: expect.objectContaining({ connectionId: 'https://git.euraika.net' }),
    },
  ]);
  const connections = JSON.parse(
    (await root.getByTestId('onboarding-connections').textContent()) ?? '[]',
  );
  expect(connections).toEqual([
    expect.objectContaining({
      id: 'https://github.com',
      provider: 'github',
      enabled: true,
      isConfigured: true,
      user: expect.objectContaining({ login: 'github-user' }),
    }),
    expect.objectContaining({
      id: 'https://second.example',
      provider: 'gitlab',
      enabled: true,
      isConfigured: true,
      user: expect.objectContaining({ login: 'second-user' }),
    }),
    expect.objectContaining({
      id: 'https://git.euraika.net',
      provider: 'gitlab',
      enabled: true,
      isConfigured: true,
      user: expect.objectContaining({ login: 'camiel-user' }),
    }),
  ]);
  expect(calls.some((call) => call.method === 'github.repos.list')).toBe(false);
  expect(calls.some((call) => call.method === 'github.connect')).toBe(false);
});
