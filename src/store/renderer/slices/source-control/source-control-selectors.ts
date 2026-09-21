import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { initialState } from './source-control-slice';
import type { SourceControlSettings } from '$features/source-control/types';

export const selectSourceControlConnections = store.createSelector((state) =>
  getItems((state.sourceControl ?? initialState).connections),
);
export const selectSelectedSourceControlConnectionId = store.createSelector(
  (state) => (state.sourceControl ?? initialState).selectedConnectionId,
);
const selectSourceControlConnectionById = store.createSelector((state, id: string) =>
  getItem((state.sourceControl ?? initialState).connections, id),
);
export const selectSelectedSourceControlConnection = store.createSelector((state) =>
  selectSourceControlConnectionById.select(
    state,
    selectSelectedSourceControlConnectionId.select(state),
  ),
);
export const selectSourceControlSettings = store.createSelector((state): SourceControlSettings => {
  const connection = selectSelectedSourceControlConnection.select(state);
  return {
    connections: selectSourceControlConnections.select(state),
    connectionId: connection?.id ?? 'https://github.com',
    provider: connection?.provider ?? 'github',
    instanceUrl: connection?.instanceUrl ?? 'https://github.com',
    tokenSource: connection?.tokenSource ?? 'auto',
    gitlabSupported: (state.sourceControl ?? initialState).loaded,
  };
});
export const selectSourceControlIsAuthenticated = store.createSelector((state) => {
  const connection = selectSelectedSourceControlConnection.select(state);
  return connection?.enabled === true && connection.isConfigured;
});
export const selectSourceControlUser = store.createSelector(
  (state) => selectSelectedSourceControlConnection.select(state)?.user ?? null,
);
export const selectSourceControlBusy = store.createSelector(
  (state) => (state.sourceControl ?? initialState).busy,
);
export const selectSourceControlError = store.createSelector(
  (state) => (state.sourceControl ?? initialState).error,
);
export const selectSourceControlRepositoryNamespace = store.createSelector((state) => {
  const connection = selectSelectedSourceControlConnection.select(state);
  return JSON.stringify([
    selectSelectedSourceControlConnectionId.select(state),
    connection?.enabled,
    connection?.isConfigured,
    connection?.user?.login,
  ]);
});

export const selectWorkspaceSourceControlSettings = store.createSelector(
  (state, workspaceId: string): SourceControlSettings => {
    const repository = state.sourceControl?.byWorkspaceId[workspaceId]?.repository;
    const connection = repository
      ? selectSourceControlConnectionById.select(state, repository.connectionId)
      : undefined;
    return {
      provider: repository?.provider ?? 'github',
      instanceUrl: repository?.instanceUrl ?? 'https://github.com',
      connectionId: repository?.connectionId,
      tokenSource: connection?.tokenSource ?? 'auto',
      gitlabSupported: true,
      connections: selectSourceControlConnections.select(state),
    };
  },
);
export const selectWorkspaceSourceControlIsAuthenticated = store.createSelector(
  (state, workspaceId: string) => {
    const identity = state.sourceControl?.byWorkspaceId[workspaceId]?.repository;
    const connection = identity
      ? selectSourceControlConnectionById.select(state, identity.connectionId)
      : undefined;
    return connection?.enabled === true && connection.isConfigured;
  },
);

export const selectWorkspaceSourceControlIdentities = store.createSelector(
  (state) => (state.sourceControl ?? initialState).byWorkspaceId,
);
