import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: request }));
import {
  configureSourceControl,
  disconnectSourceControl,
  listSourceControlConnections,
  sourceControlAuthStatus,
  resolveSourceControlRepository,
} from './source-control.client';

describe('source-control connection registry wire contract', () => {
  beforeEach(() => {
    request.mockReset();
  });
  it('saves credentials with the exact instance identity in one registry mutation', async () => {
    const connection = { id: 'https://git.example/gitlab', provider: 'gitlab' };
    request.mockResolvedValue({ connection });
    expect(
      await configureSourceControl({
        provider: 'gitlab',
        instanceUrl: ' https://git.example/gitlab ',
        tokenSource: 'explicit',
        token: 'synthetic-secret',
      }),
    ).toEqual(connection);
    expect(request).toHaveBeenCalledExactlyOnceWith('sourceControl.connections.configure', {
      provider: 'gitlab',
      instanceUrl: 'https://git.example/gitlab',
      tokenSource: 'explicit',
      token: 'synthetic-secret',
    });
  });
  it('disconnects only the addressed connection', async () => {
    request.mockResolvedValue({ connection: { id: 'https://git.one.example', enabled: false } });
    await disconnectSourceControl('https://git.one.example');
    expect(request).toHaveBeenCalledExactlyOnceWith('sourceControl.connections.disconnect', {
      connectionId: 'https://git.one.example',
    });
  });
  it('reads every connection independently of UI selection', async () => {
    const connections = [
      { id: 'https://github.com' },
      { id: 'https://git.one.example' },
      { id: 'https://git.two.example' },
    ];
    request.mockResolvedValue({ connections });
    expect(await listSourceControlConnections()).toEqual(connections);
    expect(request).toHaveBeenCalledExactlyOnceWith('sourceControl.connections.list');
  });
  it('preserves the server identity supplied by authStatus and resolves resource URLs server-side', async () => {
    const connection = {
      id: 'https://git.example/gitlab',
      provider: 'gitlab',
      instanceUrl: 'https://git.example/gitlab',
    };
    request.mockResolvedValueOnce({ connection }).mockResolvedValueOnce({
      ...connection,
      connectionId: connection.id,
      repo: {
        owner: 'team/sub',
        name: 'camiel',
        htmlUrl: 'https://git.example/gitlab/team/sub/camiel',
      },
      resource: { kind: 'pr', number: 7 },
    });
    expect(await sourceControlAuthStatus(connection.id)).toEqual(connection);
    expect(
      await resolveSourceControlRepository({
        repoUrl: 'https://git.example/gitlab/team/sub/camiel/-/merge_requests/7',
      }),
    ).toMatchObject({ resource: { kind: 'pr', number: 7 } });
    expect(request.mock.calls).toEqual([
      ['sourceControl.authStatus', { connectionId: connection.id }],
      [
        'sourceControl.resolve',
        { repoUrl: 'https://git.example/gitlab/team/sub/camiel/-/merge_requests/7' },
      ],
    ]);
  });
});
