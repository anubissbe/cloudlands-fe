import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  sourceControlReducer as reduce,
  initialState,
  setSourceControlConnections,
  setSourceControlConnection,
  selectSourceControlConnection,
  setSourceControlBusy,
  setSourceControlError,
  setSourceControlConnectionsLoading,
  setWorkspaceSourceControl,
  configureSourceControlRequested,
} from './source-control-slice';
import type { SourceControlConnection } from '$features/source-control/types';
const connection = (id: string): SourceControlConnection => ({
  id,
  provider: id === 'https://github.com' ? 'github' : 'gitlab',
  instanceUrl: id,
  tokenSource: 'explicit',
  enabled: true,
  isConfigured: true,
  user: { login: 'bert', avatarUrl: '', htmlUrl: `${id}/bert` },
});
describe('source-control registry reducer', () => {
  it('starts with no assumed authentication', () => {
    expect(getItems(initialState.connections)).toEqual([]);
    expect(initialState.loaded).toBe(false);
  });
  it('retains simultaneous accounts when selecting and disconnecting one host', () => {
    const gh = connection('https://github.com'),
      one = connection('https://git.one.example'),
      two = connection('https://git.two.example');
    let state = reduce(initialState, setSourceControlConnections([gh, one, two]));
    state = reduce(state, selectSourceControlConnection(two.id));
    state = reduce(
      state,
      setSourceControlConnection({ ...one, enabled: false, isConfigured: false, user: null }),
    );
    expect(state.selectedConnectionId).toBe(two.id);
    expect(getItem(state.connections, gh.id)).toEqual(gh);
    expect(getItem(state.connections, two.id)).toEqual(two);
    expect(getItem(state.connections, one.id)?.enabled).toBe(false);
    expect(state.loaded).toBe(true);
  });
  it('tracks request state and never persists a submitted credential', () => {
    let state = reduce(initialState, setSourceControlConnectionsLoading());
    expect(state.loading).toBe(true);
    state = reduce(state, setSourceControlError('Failed'));
    expect(state.loading).toBe(false);
    state = reduce(state, setSourceControlBusy(true));
    expect(state.error).toBeNull();
    state = reduce(state, setSourceControlBusy(false));
    expect(state.busy).toBe(false);
    const action = configureSourceControlRequested({
      provider: 'gitlab',
      instanceUrl: 'https://git.example',
      tokenSource: 'explicit',
      token: 'synthetic-secret',
    });
    expect(JSON.stringify([action, reduce(state, action)])).not.toContain('synthetic-secret');
  });
  it('keeps workspace origin identities separate from the browsing connection', () => {
    const identity = {
      connectionId: 'https://git.one.example',
      provider: 'gitlab' as const,
      instanceUrl: 'https://git.one.example',
      repo: {
        owner: 'team/sub',
        name: 'project',
        htmlUrl: 'https://git.one.example/team/sub/project',
      },
    };
    let state = reduce(initialState, setWorkspaceSourceControl('workspace-one', identity));
    state = reduce(state, selectSourceControlConnection('https://github.com'));
    expect(state.byWorkspaceId['workspace-one'].repository).toEqual(identity);
    state = reduce(state, setWorkspaceSourceControl('workspace-two', null));
    expect(state.byWorkspaceId['workspace-one'].repository).toEqual(identity);
    state = reduce(state, workspaceUnmounted('workspace-one' as WorkspaceId));
    expect(state.byWorkspaceId['workspace-one']).toBeUndefined();
    expect(state.byWorkspaceId['workspace-two']).toEqual({ repository: null });
  });
});
