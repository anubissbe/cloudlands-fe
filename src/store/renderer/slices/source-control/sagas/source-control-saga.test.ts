import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  configure: vi.fn(),
  disconnect: vi.fn(),
  resolve: vi.fn(),
  status: vi.fn(),
}));
vi.mock('$features/source-control/renderer/source-control.client', () => ({
  listSourceControlConnections: mocks.list,
  configureSourceControl: mocks.configure,
  disconnectSourceControl: mocks.disconnect,
  resolveSourceControlRepository: mocks.resolve,
  sourceControlAuthStatus: mocks.status,
}));
import { sourceControlSaga } from './source-control-saga';
import {
  sourceControlReducer,
  initialState,
  configureSourceControlRequested,
  loadWorkspaceSourceControl,
  disconnectSourceControlRequested,
  loadSourceControlConnections,
  setSourceControlConnections,
  selectSourceControlConnection,
} from '../source-control-slice';
import type { SourceControlConnection } from '$features/source-control/types';
const gh: SourceControlConnection = {
  id: 'https://github.com',
  instanceUrl: 'https://github.com',
  provider: 'github',
  enabled: true,
  isConfigured: true,
  tokenSource: 'auto',
  user: { login: 'github-user', avatarUrl: '', htmlUrl: '' },
};
const gl: SourceControlConnection = {
  ...gh,
  id: 'https://git.example',
  instanceUrl: 'https://git.example',
  provider: 'gitlab',
  tokenSource: 'explicit',
  user: { login: 'gitlab-user', avatarUrl: '', htmlUrl: '' },
};
function harness() {
  const channel = stdChannel();
  let state = sourceControlReducer(initialState, setSourceControlConnections([gh]));
  const actions: unknown[] = [];
  const dispatch = (action: never) => {
    actions.push(action);
    state = sourceControlReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ sourceControl: state }) },
    sourceControlSaga,
  );
  return { channel, task, state: () => state, actions, dispatch };
}
describe('source-control connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([gh, gl]);
    mocks.configure.mockResolvedValue(gl);
    mocks.disconnect.mockResolvedValue({ ...gl, enabled: false, isConfigured: false, user: null });
  });
  it('consumes PAT once without serializing it and retains the GitHub account', async () => {
    const run = harness();
    const action = configureSourceControlRequested({
      provider: 'gitlab',
      instanceUrl: gl.id,
      tokenSource: 'explicit',
      token: 'synthetic-secret',
    });
    run.channel.put(action);
    await vi.waitFor(() => expect(run.state().busy).toBe(false));
    await vi.waitFor(() => expect(run.state().selectedConnectionId).toBe(gl.id));
    expect(mocks.configure).toHaveBeenCalledWith({
      provider: 'gitlab',
      instanceUrl: gl.id,
      tokenSource: 'explicit',
      token: 'synthetic-secret',
    });
    expect(getItem(run.state().connections, gh.id)).toEqual(gh);
    expect(JSON.stringify([action, run.actions, run.state()])).not.toContain('synthetic-secret');
    run.task.cancel();
  });
  it('disconnects only one host without changing the browsing selection', async () => {
    mocks.list.mockResolvedValue([gh, { ...gl, enabled: false, isConfigured: false, user: null }]);
    const run = harness();
    run.channel.put(disconnectSourceControlRequested(gl.id));
    await vi.waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith(gl.id));
    await vi.waitFor(() => expect(run.state().busy).toBe(false));
    expect(getItem(run.state().connections, gh.id)).toEqual(gh);
    expect(run.state().selectedConnectionId).toBe(gh.id);
    run.task.cancel();
  });
  it('a stale registry read cannot undo a newly verified connection', async () => {
    let resolveOld!: (value: SourceControlConnection[]) => void;
    mocks.list.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const run = harness();
    run.channel.put(loadSourceControlConnections());
    run.channel.put(
      configureSourceControlRequested({
        provider: 'gitlab',
        instanceUrl: gl.id,
        tokenSource: 'explicit',
      }),
    );
    await vi.waitFor(() => expect(run.state().selectedConnectionId).toBe(gl.id));
    resolveOld([gh]);
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getItems(run.state().connections)).toHaveLength(2));
    run.task.cancel();
  });
  it('selecting another account clears repository results without changing credentials', async () => {
    const run = harness();
    run.dispatch(selectSourceControlConnection(gl.id) as never);
    await vi.waitFor(() =>
      expect(run.actions).toContainEqual({ type: 'githubRepos/clear', payload: [] }),
    );
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    run.task.cancel();
  });
  it('does not expose credential-bearing backend errors', async () => {
    mocks.configure.mockRejectedValueOnce(new Error('synthetic-secret rejected'));
    const run = harness();
    run.channel.put(
      configureSourceControlRequested({
        provider: 'gitlab',
        instanceUrl: gl.id,
        tokenSource: 'explicit',
        token: 'synthetic-secret',
      }),
    );
    await vi.waitFor(() => expect(run.state().error).toBeTruthy());
    expect(JSON.stringify(run.state())).not.toContain('synthetic-secret');
    run.task.cancel();
  });
  it('a late workspace auth probe cannot reconnect a disconnected server', async () => {
    let resolveStatus!: (value: SourceControlConnection) => void;
    mocks.resolve.mockResolvedValue({
      connectionId: gl.id,
      provider: gl.provider,
      instanceUrl: gl.instanceUrl,
      repo: { owner: 'team', name: 'repo', htmlUrl: `${gl.id}/team/repo` },
    });
    mocks.status.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    mocks.list.mockResolvedValue([gh, { ...gl, enabled: false, isConfigured: false, user: null }]);
    const run = harness();
    run.dispatch(loadWorkspaceSourceControl('workspace-a') as never);
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledWith(gl.id));
    run.channel.put(disconnectSourceControlRequested(gl.id));
    await vi.waitFor(() => expect(getItem(run.state().connections, gl.id)?.enabled).toBe(false));
    resolveStatus(gl);
    await Promise.resolve();
    await Promise.resolve();
    expect(getItem(run.state().connections, gl.id)?.enabled).toBe(false);
    run.task.cancel();
  });
  it('does not restore workspace identity after its route is unmounted', async () => {
    let resolveRepository!: (value: unknown) => void;
    mocks.resolve.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRepository = resolve;
      }),
    );
    const run = harness();
    run.dispatch(loadWorkspaceSourceControl('workspace-a') as never);
    run.dispatch(workspaceUnmounted('workspace-a' as WorkspaceId) as never);
    resolveRepository({
      connectionId: gl.id,
      provider: gl.provider,
      instanceUrl: gl.instanceUrl,
      repo: { owner: 'team', name: 'repo', htmlUrl: `${gl.id}/team/repo` },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(run.state().byWorkspaceId['workspace-a']).toBeUndefined();
    expect(mocks.status).not.toHaveBeenCalled();
    run.task.cancel();
  });
});
