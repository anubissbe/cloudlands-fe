import { describe, expect, it } from 'vitest';
import {
  parseForgeRemote,
  parseRepositoryInput,
  repositoryInputUrl,
  repositoryUrl,
} from './repository';

const gitlab = { provider: 'gitlab' as const, instanceUrl: 'https://git.euraika.net' };
describe('parseForgeRemote', () => {
  it.each([
    'git@git.euraika.net:team/subgroup/project.git',
    'https://git.euraika.net/team/subgroup/project.git',
    'ssh://git@git.euraika.net:2222/team/subgroup/project.git',
  ])('preserves nested namespaces: %s', (remote) => {
    expect(parseForgeRemote(remote, gitlab)).toEqual({ owner: 'team/subgroup', repo: 'project' });
  });
  it('never routes a different host to the configured provider', () => {
    expect(parseForgeRemote('https://git.euraika.net.evil.test/team/project', gitlab)).toBeNull();
    expect(parseForgeRemote('https://gitlab.com/team/project', gitlab)).toBeNull();
    expect(parseForgeRemote('https://git.euraika.net:8443/team/project', gitlab)).toBeNull();
  });
  it('supports a GitLab relative URL installation', () => {
    expect(
      parseForgeRemote('https://example.com/gitlab/group/sub/repo.git', {
        provider: 'gitlab',
        instanceUrl: 'https://example.com/gitlab',
      }),
    ).toEqual({ owner: 'group/sub', repo: 'repo' });
  });
  it('keeps ordinary GitHub parsing unchanged', () => {
    expect(parseForgeRemote('git@github.com:intent-hq/intent.git')).toEqual({
      owner: 'intent-hq',
      repo: 'intent',
    });
    expect(parseForgeRemote('https://example.com/team/project')).toBeNull();
    expect(parseForgeRemote('https://github.com/a/b/c')).toBeNull();
  });
});

describe('repository selection input', () => {
  it('constructs selected-instance URLs only from valid nested shorthand', () => {
    expect(repositoryInputUrl('euraika/platform/camiel', gitlab)).toBe(
      'https://git.euraika.net/euraika/platform/camiel',
    );
    expect(parseRepositoryInput('euraika/platform/camiel', gitlab)).toEqual({
      owner: 'euraika/platform',
      repo: 'camiel',
    });
    expect(repositoryInputUrl('../camiel', gitlab)).toBe('');
    expect(repositoryInputUrl('euraika/../camiel', gitlab)).toBe('');
    expect(repositoryInputUrl('https://github.com/euraika/camiel', gitlab)).toBe(
      'https://github.com/euraika/camiel',
    );
    expect(repositoryInputUrl('http://git.euraika.net/euraika/camiel', gitlab)).toBe('');
  });
  it('preserves explicit SSH and canonical API URLs without rebuilding their host', () => {
    expect(repositoryInputUrl('git@git.euraika.net:euraika/platform/camiel.git', gitlab)).toBe(
      'git@git.euraika.net:euraika/platform/camiel.git',
    );
    expect(
      repositoryUrl(
        {
          owner: 'euraika/platform',
          name: 'camiel',
          htmlUrl: 'https://git.euraika.net/euraika/platform/camiel',
        },
        gitlab,
      ),
    ).toBe('https://git.euraika.net/euraika/platform/camiel');
  });
  it('preserves GitHub subpage paste convenience', () => {
    expect(repositoryInputUrl('https://github.com/octo/alpha/tree/main')).toBe(
      'https://github.com/octo/alpha',
    );
  });
});
