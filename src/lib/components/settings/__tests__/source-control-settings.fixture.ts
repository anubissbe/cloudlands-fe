import { runSaga, stdChannel } from 'redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
import '$store/renderer/seeders/integrations-bridge-seeder';
import { store as appStore } from '$store/renderer/store';
import { sourceControlSaga } from '$store/renderer/slices/source-control/sagas/source-control-saga';
import {
  selectSourceControlConnection,
  setSourceControlConnections,
} from '$store/renderer/slices/source-control/source-control-slice';
import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
import type { SourceControlConnection } from '$features/source-control/types';

export function installSourceControlSettingsFixture(
  onCalls: (calls: Array<{ method: string; params?: unknown }>) => void,
  onActions: (actions: unknown[]) => void,
): () => void {
  const connections: SourceControlConnection[] = [
    {
      id: 'https://github.com',
      instanceUrl: 'https://github.com',
      provider: 'github',
      enabled: true,
      isConfigured: true,
      tokenSource: 'auto',
      user: { login: 'github-user', avatarUrl: '', htmlUrl: 'https://github.com/github-user' },
    },
    {
      id: 'https://git.euraika.net',
      instanceUrl: 'https://git.euraika.net',
      provider: 'gitlab',
      enabled: true,
      isConfigured: false,
      tokenSource: 'explicit',
      user: null,
    },
  ];
  let calls: Array<{ method: string; params?: unknown }> = [],
    actions: unknown[] = [];
  const previousBridge = window.electronAPI;
  const previousAuth = appStore.state.githubAuth;
  const previousRegistry = appStore.state.sourceControl;
  const previousDispatchDescriptor = Object.getOwnPropertyDescriptor(appStore, 'dispatch');
  const dispatch = appStore.dispatch;
  const channel = stdChannel();
  function record(method: string, params?: unknown) {
    // The fixture surfaces only redacted observations, including in failure screenshots.
    const safeParams =
      params && typeof params === 'object' && 'token' in params
        ? { ...params, token: '[redacted]' }
        : params;
    calls = [...calls, { method, ...(safeParams === undefined ? {} : { params: safeParams }) }];
    onCalls(calls);
  }
  installMockElectronBridge({
    'sourceControl.connections.list': () => {
      record('sourceControl.connections.list');
      return { connections: [...connections] };
    },
    'sourceControl.connections.configure': (params) => {
      record('sourceControl.connections.configure', params);
      const input = params as {
        instanceUrl: string;
        tokenSource: SourceControlConnection['tokenSource'];
        token?: string;
      };
      const connection: SourceControlConnection = {
        id: input.instanceUrl,
        instanceUrl: input.instanceUrl,
        provider: 'gitlab',
        tokenSource: input.tokenSource,
        enabled: true,
        isConfigured: Boolean(input.token),
        user: input.token
          ? {
              login:
                input.instanceUrl === 'https://git.euraika.net' ? 'fixture-user' : 'second-user',
              avatarUrl: '',
              htmlUrl: `${input.instanceUrl}/user`,
            }
          : null,
      };
      const index = connections.findIndex((item) => item.id === connection.id);
      if (index >= 0) connections[index] = connection;
      else connections.push(connection);
      return { connection };
    },
    'sourceControl.connections.disconnect': (params) => {
      record('sourceControl.connections.disconnect', params);
      const index = connections.findIndex(
        (item) => item.id === (params as { connectionId: string }).connectionId,
      );
      const connection = { ...connections[index], enabled: false, isConfigured: false, user: null };
      connections[index] = connection;
      return { connection };
    },
    'github.authStatus': () => ({
      isConfigured: true,
      configuredButNeedsUpdate: false,
      oauthUrl: '',
      updatedScopes: '',
    }),
    'github.getUser': () => ({ user: connections[0].user }),
  });
  dispatch(setSourceControlConnections(connections));
  dispatch(selectSourceControlConnection('https://git.euraika.net'));
  dispatch(
    setGitHubAuthState({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      needsScopeUpdate: false,
      oauthUrl: null,
      user: { login: 'github-user', name: null, email: null, avatar_url: '' },
    }),
  );
  const forward: typeof dispatch = (action) => {
    actions = [...actions, action];
    onActions(actions);
    const result = dispatch(action);
    channel.put(action);
    return result;
  };
  Object.defineProperty(appStore, 'dispatch', { configurable: true, value: forward });
  const task = runSaga(
    { channel, getState: () => appStore.getStoreStateSnapshot(), dispatch: forward },
    sourceControlSaga,
  );
  return () => {
    task.cancel();
    channel.close();
    if (previousDispatchDescriptor)
      Object.defineProperty(appStore, 'dispatch', previousDispatchDescriptor);
    dispatch(setGitHubAuthState(previousAuth));
    dispatch(setSourceControlConnections(getItems(previousRegistry.connections)));
    dispatch(selectSourceControlConnection(previousRegistry.selectedConnectionId));
    window.electronAPI = previousBridge;
  };
}
