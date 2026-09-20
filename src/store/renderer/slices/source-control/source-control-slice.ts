import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { prepareSourceControlConfiguration } from '$features/source-control/credential-handoff';
import type { SourceControlConfiguration } from '$features/source-control/types';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  upsertItem,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  SourceControlConnection,
  ResolvedSourceControlRepository,
} from '$features/source-control/types';

export interface SourceControlState {
  byWorkspaceId: Record<string, { repository: ResolvedSourceControlRepository | null }>;
  connections: Collection<SourceControlConnection, 'id'>;
  selectedConnectionId: string;
  loading: boolean;
  loaded: boolean;
  busy: boolean;
  error: string | null;
}
export const initialState: SourceControlState = {
  byWorkspaceId: {},
  connections: createCollection<SourceControlConnection, 'id'>('id'),
  selectedConnectionId: 'https://github.com',
  loading: false,
  loaded: false,
  busy: false,
  error: null,
};
export const configureSourceControlRequested = createAction(
  'sourceControl/configure',
  (config: SourceControlConfiguration): [SourceControlConfiguration] => [
    prepareSourceControlConfiguration(config),
  ],
);
export const loadSourceControlConnections = createAction('sourceControl/loadConnections');
export const setSourceControlConnectionsLoading = createAction('sourceControl/setLoading');
export const setSourceControlConnections = createAction<[connections: SourceControlConnection[]]>(
  'sourceControl/setConnections',
);
export const setSourceControlConnection = createAction<[connection: SourceControlConnection]>(
  'sourceControl/setConnection',
);
export const selectSourceControlConnection = createAction<[connectionId: string]>(
  'sourceControl/selectConnection',
);
export const setSourceControlBusy = createAction<[busy: boolean]>('sourceControl/setBusy');
export const setSourceControlError = createAction<[error: string | null]>('sourceControl/setError');
export const disconnectSourceControlRequested = createAction<[connectionId: string]>(
  'sourceControl/disconnect',
);
export const sourceControlReducer = createReducer<SourceControlState>(initialState);
sourceControlReducer.with(setSourceControlConnectionsLoading, (state) => ({
  ...state,
  loading: true,
}));
sourceControlReducer.with(setSourceControlConnections, (state, { payload: [connections] }) => ({
  ...state,
  connections: createCollection<SourceControlConnection, 'id'>('id', connections),
  loading: false,
  loaded: true,
}));
sourceControlReducer.with(setSourceControlConnection, (state, { payload: [connection] }) => ({
  ...state,
  connections: upsertItem(state.connections, connection),
}));
sourceControlReducer.with(
  selectSourceControlConnection,
  (state, { payload: [selectedConnectionId] }) => ({ ...state, selectedConnectionId, error: null }),
);
sourceControlReducer.with(setSourceControlBusy, (state, { payload: [busy] }) => ({
  ...state,
  busy,
  error: busy ? null : state.error,
}));
sourceControlReducer.with(setSourceControlError, (state, { payload: [error] }) => ({
  ...state,
  error,
  loading: false,
}));

export const loadWorkspaceSourceControl = createAction<[workspaceId: string]>(
  'sourceControl/loadWorkspace',
);
export const setWorkspaceSourceControl = createAction<
  [workspaceId: string, repository: ResolvedSourceControlRepository | null]
>('sourceControl/setWorkspace');
const workspaceState = createWorkspaceScopedHelpers<{
  repository: ResolvedSourceControlRepository | null;
}>({ repository: null });
sourceControlReducer.with(
  setWorkspaceSourceControl,
  (state, { payload: [workspaceId, repository] }) =>
    workspaceState.setWorkspaceState(state, workspaceId, { repository }),
);

sourceControlReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  workspaceState.clearWorkspaceState(state, workspaceId),
);
