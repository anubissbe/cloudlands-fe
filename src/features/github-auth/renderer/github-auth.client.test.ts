import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { GITHUB_AUTH_CHANNELS } from '../constants';
import { githubAuthClient } from './github-auth.client';

describe('githubAuthClient repository search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the exact search IPC request and returns the protocol-shaped envelope', async () => {
    const response = {
      success: true,
      data: [{ owner: 'octocat', name: 'hello', default_branch: 'main' }],
    };
    mocks.invoke.mockResolvedValueOnce(response);

    await expect(githubAuthClient.searchRepos('hello')).resolves.toEqual(response);
    expect(mocks.invoke).toHaveBeenCalledWith(GITHUB_AUTH_CHANNELS.SEARCH_REPOS, {
      query: 'hello',
    });
  });
});

describe('githubAuthClient user search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the exact search IPC request and returns the protocol-shaped envelope', async () => {
    const response = {
      success: true,
      data: [
        {
          id: 1,
          login: 'octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          htmlUrl: 'https://github.com/octocat',
        },
      ],
    };
    mocks.invoke.mockResolvedValueOnce(response);

    await expect(githubAuthClient.searchUsers('octo')).resolves.toEqual(response);
    expect(mocks.invoke).toHaveBeenCalledWith(GITHUB_AUTH_CHANNELS.SEARCH_USERS, {
      query: 'octo',
    });
  });

  it('normalizes a thrown transport error into an unsuccessful envelope', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('ipc down'));

    await expect(githubAuthClient.searchUsers('octo')).resolves.toEqual({
      success: false,
      error: 'ipc down',
    });
  });
});

describe('githubAuthClient repository listing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the selected server in the list request', async () => {
    const repos = [{ owner: 'group/nested', name: 'project', default_branch: 'main' }];
    mocks.invoke.mockResolvedValueOnce({ success: true, data: repos });
    await expect(
      githubAuthClient.listRepos(undefined, { connectionId: 'https://git.euraika.net' }),
    ).resolves.toEqual(repos);
    expect(mocks.invoke).toHaveBeenCalledWith(GITHUB_AUTH_CHANNELS.LIST_REPOS, {
      page: undefined,
      connectionId: 'https://git.euraika.net',
    });
  });

  it('surfaces an unsuccessful RPC envelope instead of treating it as an empty account', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: false, error: 'Connection is not configured' });
    await expect(githubAuthClient.listRepos()).rejects.toThrow('Connection is not configured');
  });

  it('preserves a transport failure for the retry UI', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('Socket disconnected'));
    await expect(githubAuthClient.listRepos()).rejects.toThrow('Socket disconnected');
  });
});
