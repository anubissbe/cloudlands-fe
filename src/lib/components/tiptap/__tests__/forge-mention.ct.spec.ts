import { expect, test } from '../../../../test/ct-test';
import ForgeMentionHarness from './ForgeMentionHarness.svelte';

for (const scenario of [
  { width: 720, theme: 'dark' as const },
  { width: 1280, theme: 'light' as const },
]) {
  test(`GitLab mention preserves its link, icon and avatar at ${scenario.width}px in ${scenario.theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 650 });
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.classList.toggle('light', theme === 'light');
    }, scenario.theme);
    const githubRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('github.com')) githubRequests.push(request.url());
    });
    const root = await mount(ForgeMentionHarness, { props: { theme: scenario.theme } });
    const pill = root.getByText('euraika/platform/camiel#12', { exact: true });
    await expect(pill).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('color-scheme', scenario.theme);
    await expect(root.locator('img[src*="github.com"]')).toHaveCount(0);
    await pill.hover();
    await expect(page.getByText('GitLab', { exact: true })).toBeVisible();
    await expect(page.getByText('GitHub', { exact: true })).toHaveCount(0);
    expect(await root.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`gitlab-mention-${scenario.theme}.png`) });
    await pill.click();
    await expect(root.getByTestId('opened-forge-url')).toHaveText(
      'https://git.example:8443/gitlab/euraika/platform/camiel/-/merge_requests/12#note_42',
    );
    expect(githubRequests).toEqual([]);
  });
}
