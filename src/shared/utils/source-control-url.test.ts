import { describe, expect, it } from 'vitest';
import { parseSourceControlLink } from './source-control-url';
const identities = [
  { provider: 'gitlab' as const, instanceUrl: 'https://git.one.example' },
  { provider: 'gitlab' as const, instanceUrl: 'https://git.two.example:8443/gitlab' },
];
describe('source-control links', () => {
  it.each([
    ['https://github.com/team/camiel/pull/12', 'https://github.com', 'team', 'pr', 12],
    [
      'https://git.one.example/team/sub/camiel/-/merge_requests/12',
      'https://git.one.example',
      'team/sub',
      'pr',
      12,
    ],
    [
      'https://git.two.example:8443/gitlab/team/sub/camiel/-/issues/7',
      'https://git.two.example:8443/gitlab',
      'team/sub',
      'issue',
      7,
    ],
    [
      'https://git.one.example/team/sub/camiel',
      'https://git.one.example',
      'team/sub',
      'project',
      undefined,
    ],
  ])(
    'preserves the authority and nested project for %s',
    (url, connectionId, owner, kind, number) => {
      expect(parseSourceControlLink(url as string, identities)).toMatchObject({
        connectionId,
        owner,
        repo: 'camiel',
        kind,
        ...(number ? { number } : {}),
      });
    },
  );
  it.each([
    'https://git.one.example.evil.test/team/camiel',
    'https://git.one.example:8443/team/camiel',
    'https://git.two.example:8443/team/camiel',
    'http://git.one.example/team/camiel',
    'https://user:secret@git.one.example/team/camiel',
    'https://unknown.example/team/camiel',
    'https://git.one.example/team/camiel/-/merge_requests/nope',
  ])('rejects unknown or mismatched server identities: %s', (url) => {
    expect(parseSourceControlLink(url, identities)).toBeNull();
  });
  it('keeps identical project names on different hosts distinct', () => {
    const first = parseSourceControlLink(
      'https://git.one.example/team/camiel/-/issues/1',
      identities,
    );
    const second = parseSourceControlLink(
      'https://git.two.example:8443/gitlab/team/camiel/-/issues/1',
      identities,
    );
    expect(first?.projectUrl).not.toBe(second?.projectUrl);
    expect(first?.connectionId).not.toBe(second?.connectionId);
  });
  it('does not guess an SSH authority when a host has multiple HTTPS installations', () => {
    expect(
      parseSourceControlLink('git@git.one.example:team/camiel.git', [
        ...identities,
        { provider: 'gitlab', instanceUrl: 'https://git.one.example/other' },
      ]),
    ).toBeNull();
  });
});
