import { runSaga, stdChannel } from 'redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { installMockElectronBridge } from '../../../test/ct-mock-electron-bridge';
import '$store/renderer/seeders/integrations-bridge-seeder';
import '$store/renderer/seeders/host-bridge-seeder';
import { store as appStore } from '$store/renderer/store';
import { githubAuthSaga } from '$store/renderer/slices/github-auth/sagas/github-auth-saga';
import { sourceControlSaga } from '$store/renderer/slices/source-control/sagas/source-control-saga';
import { lifecycleIpcReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-ipc-read-saga';
import { githubRepoSearchSaga } from '$store/renderer/slices/github-repo-search/sagas/github-repo-search-saga';
import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
import { setGithubRepos } from '$store/renderer/slices/github-repos/github-repos-slice';
import {
  selectSourceControlConnection,
  setSourceControlConnections,
} from '$store/renderer/slices/source-control/source-control-slice';
import type { SourceControlConnection } from '$features/source-control/types';

export interface OnboardingRpcCall {
  method: string;
  params?: unknown;
}

export function installGitlabOnboardingFixture(
  onCalls: (calls: OnboardingRpcCall[]) => void,
): () => void {
  // Script only the daemon boundary. Real reducers, registry/auth/repository
  // sagas and IPC adapters must preserve each independently connected account.
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
      id: 'https://second.example',
      instanceUrl: 'https://second.example',
      provider: 'gitlab',
      enabled: true,
      isConfigured: true,
      tokenSource: 'explicit',
      user: { login: 'second-user', avatarUrl: '', htmlUrl: 'https://second.example/second-user' },
    },
  ];
  const calls: OnboardingRpcCall[] = [];
  const previousBridge = window.electronAPI;
  const previousAuth = appStore.state.githubAuth;
  const previousRegistry = appStore.state.sourceControl;
  const previousRepos = appStore.state.githubRepos;
  const previousDispatch = Object.getOwnPropertyDescriptor(appStore, 'dispatch');
  const dispatch = appStore.dispatch;
  const channel = stdChannel();
  const record = (method: string, params?: unknown) => {
    const safeParams =
      params && typeof params === 'object' && 'token' in params
        ? { ...params, token: '[redacted]' }
        : params;
    calls.push({ method, ...(safeParams === undefined ? {} : { params: safeParams }) });
    onCalls([...calls]);
  };
  installMockElectronBridge({
    'sourceControl.connections.list': () => {
      record('sourceControl.connections.list');
      return { connections: [...connections] };
    },
    'sourceControl.connections.configure': (params) => {
      record('sourceControl.connections.configure', params);
      const input = params as {
        provider: 'gitlab';
        instanceUrl: string;
        tokenSource: SourceControlConnection['tokenSource'];
        token?: string;
      };
      if (
        input.provider !== 'gitlab' ||
        input.instanceUrl !== 'https://git.euraika.net' ||
        !input.token
      )
        throw new Error('Unexpected connection configuration');
      const connection: SourceControlConnection = {
        id: input.instanceUrl,
        instanceUrl: input.instanceUrl,
        provider: 'gitlab',
        tokenSource: input.tokenSource,
        enabled: true,
        isConfigured: true,
        user: {
          login: 'camiel-user',
          avatarUrl: '',
          htmlUrl: 'https://git.euraika.net/camiel-user',
        },
      };
      connections.push(connection);
      return { connection };
    },
    'github.authStatus': () => {
      record('github.authStatus');
      return {
        isConfigured: true,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
      };
    },
    'github.getUser': () => {
      record('github.getUser');
      return { user: connections[0].user };
    },
    'sourceControl.repos.list': (params) => {
      record('sourceControl.repos.list', params);
      if ((params as { connectionId?: string }).connectionId !== 'https://git.euraika.net')
        throw new Error('Project browsing used the wrong connection');
      return {
        repos: [
          {
            owner: 'euraika/platform',
            name: 'camiel',
            htmlUrl: 'https://git.euraika.net/euraika/platform/camiel',
            defaultBranch: 'main',
          },
        ],
        nextToken: null,
      };
    },
    'sourceControl.repos.search': (params) => {
      record('sourceControl.repos.search', params);
      if ((params as { connectionId?: string }).connectionId !== 'https://git.euraika.net')
        throw new Error('Project search used the wrong connection');
      return { repos: [], nextToken: null };
    },
    'host.directoryStatus': () => ({
      exists: false,
      isDirectory: false,
      isEmpty: true,
      isGitRepo: false,
    }),
  });
  dispatch(setSourceControlConnections(connections));
  dispatch(selectSourceControlConnection('https://github.com'));
  dispatch(
    setGitHubAuthState({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: { login: 'github-user', name: null, email: null, avatar_url: '' },
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  // A previous GitHub session populated this cache. Connecting another server
  // must replace these rows before showing its projects.
  dispatch(
    setGithubRepos([
      {
        id: 'legacy/repository',
        owner: 'legacy',
        name: 'repository',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/legacy/repository',
      },
    ]),
  );
  const forward: typeof dispatch = (action) => {
    const result = dispatch(action);
    channel.put(action);
    return result;
  };
  Object.defineProperty(appStore, 'dispatch', { configurable: true, value: forward });
  const options = { channel, getState: () => appStore.getStoreStateSnapshot(), dispatch: forward };
  const tasks = [
    runSaga(options, githubAuthSaga),
    runSaga(options, sourceControlSaga),
    runSaga(options, lifecycleIpcReadSaga),
    runSaga(options, githubRepoSearchSaga),
  ];
  return () => {
    tasks.forEach((task) => task.cancel());
    channel.close();
    if (previousDispatch) Object.defineProperty(appStore, 'dispatch', previousDispatch);
    dispatch(setGitHubAuthState(previousAuth));
    dispatch(setSourceControlConnections(getItems(previousRegistry.connections)));
    dispatch(selectSourceControlConnection(previousRegistry.selectedConnectionId));
    dispatch(setGithubRepos(getItems(previousRepos.repos)));
    window.electronAPI = previousBridge;
  };
}
