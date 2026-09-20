/**
 * @vitest-environment jsdom
 *
 * GitHubRepoTab is a pure repository picker: selecting or typing a repo
 * reports the GitHub URL to the parent, and there is NO clone-destination
 * control — the daemon owns the checkout location for picked repos (same
 * picked-repo flow as CompactWorkspaceInitializer).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(getter());
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) => {
    const fn = () => readable(getter);
    return Object.assign(fn, { select: () => getter() });
  };
  const dispatch = vi.fn();
  const repos = [
    { id: 'octo/alpha', owner: 'octo', name: 'alpha' },
    { id: 'octo/beta', owner: 'octo', name: 'beta' },
  ];
  const settings = {
    provider: 'github' as 'github' | 'gitlab',
    instanceUrl: 'https://github.com',
    tokenSource: 'auto',
    gitlabSupported: true,
  };
  return { readable, selector, dispatch, repos, settings };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$lib/electron-bridge', () => ({
  shell: { open: vi.fn(() => Promise.resolve()) },
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectSourceControlSettings: mocks.selector(() => mocks.settings),
  selectGitHubAuthIsAuthenticated: mocks.selector(() => true),
  selectSourceControlIsAuthenticated: mocks.selector(() => true),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => mocks.repos),
  selectGithubReposError: mocks.selector(() => null),
  selectGithubReposLoaded: mocks.selector(() => true),
  selectGithubReposLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-slice', () => ({
  searchGithubRepos: (query: string) => ({ type: 'githubRepoSearch/search', payload: [query] }),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', () => ({
  selectGithubRepoSearchLastQuery: mocks.selector(() => ''),
  selectGithubRepoSearchLoading: mocks.selector(() => false),
  selectGithubRepoSearchResults: mocks.selector(() => []),
}));

import GitHubRepoTab from '../GitHubRepoTab.svelte';
import { warmImport } from '../../../../test/warm-import';

const baseProps = () => ({
  githubUrl: '',
  onGithubUrlChange: vi.fn(),
});

const repoOptions = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="option"]'));

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte'));

describe('GitHubRepoTab — pure repo picker', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
    mocks.settings.provider = 'github';
    mocks.settings.instanceUrl = 'https://github.com';
    mocks.repos.splice(
      0,
      mocks.repos.length,
      { id: 'octo/alpha', owner: 'octo', name: 'alpha' },
      { id: 'octo/beta', owner: 'octo', name: 'beta' },
    );
  });

  it('labels an empty account using its selected provider', () => {
    mocks.settings.provider = 'gitlab';
    mocks.settings.instanceUrl = 'https://git.euraika.net';
    mocks.repos.splice(0);
    const { getByText, queryByText } = render(GitHubRepoTab, { props: baseProps() });
    expect(getByText('No repositories found on your GitLab account')).toBeTruthy();
    expect(queryByText('No repositories found on your GitHub account')).toBeNull();
  });

  it('clicking a repo reports its GitHub URL', async () => {
    const props = baseProps();
    const { container } = render(GitHubRepoTab, { props });

    const options = repoOptions(container);
    expect(options).toHaveLength(2);

    await fireEvent.click(options[0]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');

    await fireEvent.click(options[1]);
    expect(props.onGithubUrlChange).toHaveBeenLastCalledWith('https://github.com/octo/beta');
  });

  it('typing owner/repo reports the GitHub URL', async () => {
    const props = baseProps();
    const { container } = render(GitHubRepoTab, { props });

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await fireEvent.input(input, { target: { value: 'octo/alpha' } });

    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
  });

  it('clearing the input reports an empty URL', async () => {
    const props = { ...baseProps(), githubUrl: 'https://github.com/octo/alpha' };
    const { container } = render(GitHubRepoTab, { props });

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await fireEvent.input(input, { target: { value: '' } });

    expect(props.onGithubUrlChange).toHaveBeenCalledWith('');
  });

  it('renders no clone-destination control', () => {
    const props = baseProps();
    const { container } = render(GitHubRepoTab, { props });

    expect(
      container.querySelector('button[aria-label="Choose clone destination folder"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('Store the repository in');
  });
});

it('picks a nested GitLab API URL and preserves explicit SSH paste on Enter-to-advance', async () => {
  mocks.settings.provider = 'gitlab';
  mocks.settings.instanceUrl = 'https://git.euraika.net';
  mocks.repos.splice(0, mocks.repos.length, {
    id: 'euraika/platform/camiel',
    owner: 'euraika/platform',
    name: 'camiel',
    htmlUrl: 'https://git.euraika.net/euraika/platform/camiel',
  } as (typeof mocks.repos)[number]);
  const props = { ...baseProps(), onSelectAndAdvance: vi.fn() };
  const { container } = render(GitHubRepoTab, { props });
  await fireEvent.click(repoOptions(container)[0]);
  expect(props.onGithubUrlChange).toHaveBeenLastCalledWith(
    'https://git.euraika.net/euraika/platform/camiel',
  );
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await fireEvent.paste(input, {
    clipboardData: { getData: () => 'git@git.euraika.net:euraika/platform/camiel.git' },
  });
  expect(props.onGithubUrlChange).toHaveBeenLastCalledWith(
    'git@git.euraika.net:euraika/platform/camiel.git',
  );
  expect(props.onSelectAndAdvance).toHaveBeenLastCalledWith(
    'git@git.euraika.net:euraika/platform/camiel.git',
  );
});
