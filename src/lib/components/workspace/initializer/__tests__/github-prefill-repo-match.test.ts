/**
 * Unit tests for matchGitHubPrefillRepo: local match via stored metadata and
 * via remote probing, picked-repo GitHub fallback, and the non-fatal 'keep'
 * fallback when probing errors.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  matchGitHubPrefillRepo,
  type GitHubPrefillRepoCandidate,
} from '../github-prefill-repo-match';

const noRemote = vi.fn(async () => null);

function local(path: string, extra?: Partial<GitHubPrefillRepoCandidate>) {
  return { path, type: 'local' as const, ...extra };
}

describe('matchGitHubPrefillRepo', () => {
  it('matches a local candidate via probed git remote', async () => {
    const probeRemote = vi.fn(async (path: string) =>
      path === '/repos/monorepo' ? { owner: 'intent-hq', repo: 'monorepo' } : null,
    );
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other'), local('/repos/monorepo')],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
    expect(probeRemote).toHaveBeenCalledWith('/repos/other');
    expect(probeRemote).toHaveBeenCalledWith('/repos/monorepo');
  });

  it('matches via stored recent-repo metadata without probing', async () => {
    const probeRemote = vi.fn(async () => null);
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/monorepo', { owner: 'intent-hq', name: 'monorepo' })],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
    expect(probeRemote).not.toHaveBeenCalled();
  });

  it('matches a recent github candidate via its githubUrl', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'Intent-HQ',
      repo: 'monorepo',
      candidates: [
        {
          path: 'intent-hq/monorepo',
          type: 'github',
          githubUrl: 'https://github.com/intent-hq/monorepo.git',
        },
      ],
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'github',
      githubUrl: 'https://github.com/intent-hq/monorepo.git',
      path: 'intent-hq/monorepo',
    });
  });

  it('is case-insensitive and ignores a .git suffix', async () => {
    const probeRemote = vi.fn(async () => ({ owner: 'Intent-HQ', repo: 'Monorepo.git' }));
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/monorepo')],
      probeRemote,
    });
    expect(result).toEqual({ kind: 'local', path: '/repos/monorepo' });
  });

  it('does not probe when stored metadata is conclusive but mismatched', async () => {
    const probeRemote = vi.fn(async () => ({ owner: 'intent-hq', repo: 'monorepo' }));
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other', { owner: 'someone', name: 'other' })],
      probeRemote,
    });
    expect(probeRemote).not.toHaveBeenCalled();
    expect(result.kind).toBe('github');
  });

  it('falls back to a picked-repo GitHub selection when nothing matches', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/other')],
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'github',
      githubUrl: 'https://github.com/intent-hq/monorepo',
      path: 'intent-hq/monorepo',
    });
  });

  it('returns keep when a probe throws (non-fatal fallback)', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates: [local('/repos/a')],
      probeRemote: vi.fn(async () => {
        throw new Error('ipc down');
      }),
    });
    expect(result).toEqual({ kind: 'keep' });
  });

  it('dedupes candidates and caps remote probes at 10', async () => {
    const probeRemote = vi.fn(async () => null);
    const candidates = [
      local('/dup'),
      local('/dup'),
      ...Array.from({ length: 15 }, (_, i) => local(`/repo-${i}`)),
    ];
    const result = await matchGitHubPrefillRepo({
      owner: 'intent-hq',
      repo: 'monorepo',
      candidates,
      probeRemote,
    });
    expect(result.kind).toBe('github');
    expect(probeRemote).toHaveBeenCalledTimes(10);
  });
});

describe('registered GitLab prefill authority', () => {
  const target = {
    owner: 'team/platform',
    repo: 'camiel',
    provider: 'gitlab' as const,
    instanceUrl: 'https://git.euraika.net',
    connectionId: 'https://git.euraika.net',
    projectUrl: 'https://git.euraika.net/team/platform/camiel',
  };
  it('keeps the self-hosted nested project when no checkout matches', async () => {
    expect(
      await matchGitHubPrefillRepo({ ...target, candidates: [], probeRemote: noRemote }),
    ).toEqual({
      kind: 'github',
      path: 'team/platform/camiel',
      githubUrl: 'https://git.euraika.net/team/platform/camiel',
    });
  });
  it('does not select a same-slug checkout on another GitLab host', async () => {
    const result = await matchGitHubPrefillRepo({
      ...target,
      connections: [{ provider: 'gitlab', instanceUrl: 'https://other.example' }],
      candidates: [local('/wrong', { owner: 'team/platform', name: 'camiel' }), local('/right')],
      probeRemote: async (path) => ({
        owner: 'team/platform',
        repo: 'camiel',
        remoteUrl:
          path === '/wrong'
            ? 'git@other.example:team/platform/camiel.git'
            : 'git@git.euraika.net:team/platform/camiel.git',
      }),
    });
    expect(result).toEqual({ kind: 'local', path: '/right' });
  });
  it('rejects a foreign URL that embeds github.com in its path', async () => {
    const result = await matchGitHubPrefillRepo({
      owner: 'team',
      repo: 'camiel',
      url: 'https://github.com/team/camiel/pull/7',
      candidates: [
        { path: 'bad', type: 'github', githubUrl: 'https://evil.example/github.com/team/camiel' },
      ],
      probeRemote: noRemote,
    });
    expect(result).toEqual({
      kind: 'github',
      path: 'team/camiel',
      githubUrl: 'https://github.com/team/camiel',
    });
  });
});
