import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { selectSourceControlRepositoryNamespace } from '../source-control-selectors';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  fork,
  put,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import { consumeSourceControlConfiguration } from '$features/source-control/credential-handoff';
import {
  listSourceControlConnections,
  configureSourceControl,
  disconnectSourceControl,
  resolveSourceControlRepository,
  sourceControlAuthStatus,
} from '$features/source-control/renderer/source-control.client';
import {
  initializeGitHubAuth,
  authCompleted,
  logoutCompleted,
} from '../../github-auth/github-auth-slice';
import { clearGithubRepos } from '../../github-repos/github-repos-slice';
import { clearGithubRepoSearch } from '../../github-repo-search/github-repo-search-slice';
import {
  configureSourceControlRequested,
  loadSourceControlConnections,
  setSourceControlConnectionsLoading,
  setSourceControlConnections,
  setSourceControlConnection,
  selectSourceControlConnection,
  setSourceControlBusy,
  setSourceControlError,
  disconnectSourceControlRequested,
  loadWorkspaceSourceControl,
  setWorkspaceSourceControl,
} from '../source-control-slice';

let generation = 0;

function* refreshConnections(): SagaGenerator<void> {
  const channel = yield* actionChannel(
    [loadSourceControlConnections, initializeGitHubAuth, authCompleted, logoutCompleted],
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      yield* put(setSourceControlConnectionsLoading());
      const currentGeneration = generation;
      try {
        const connections = yield* call(listSourceControlConnections);
        if (generation === currentGeneration) yield* put(setSourceControlConnections(connections));
      } catch {
        if (generation === currentGeneration)
          yield* put(setSourceControlError(m.settings_sourceControl_connectionFailed_error()));
      }
    }
  } finally {
    channel.close();
  }
}
function* configure(
  action: ReturnType<typeof configureSourceControlRequested>,
): SagaGenerator<void> {
  const config = consumeSourceControlConfiguration(action.payload[0]);
  if (config.provider === 'github') {
    yield* put(selectSourceControlConnection('https://github.com'));
    return;
  }
  generation += 1;
  yield* put(setSourceControlBusy(true));
  try {
    const connection = yield* call(configureSourceControl, config);
    yield* put(setSourceControlConnection(connection));
    yield* put(selectSourceControlConnection(connection.id));
    if (!connection.isConfigured)
      yield* put(setSourceControlError(m.settings_sourceControl_connectionFailed_error()));
  } catch {
    yield* put(setSourceControlError(m.settings_sourceControl_connectionFailed_error()));
  } finally {
    yield* put(setSourceControlBusy(false));
    yield* put(loadSourceControlConnections());
  }
}
function* disconnect(
  action: ReturnType<typeof disconnectSourceControlRequested>,
): SagaGenerator<void> {
  generation += 1;
  yield* put(setSourceControlBusy(true));
  try {
    yield* put(setSourceControlConnection(yield* call(disconnectSourceControl, action.payload[0])));
  } catch {
    yield* put(setSourceControlError(m.settings_sourceControl_connectionFailed_error()));
  } finally {
    yield* put(setSourceControlBusy(false));
    yield* put(loadSourceControlConnections());
  }
}
export function* sourceControlSaga(): SagaGenerator<void> {
  yield* fork(refreshConnections);
  yield* takeSingleFlightInContext(
    [loadWorkspaceSourceControl, workspaceUnmounted],
    (
      action: ReturnType<typeof loadWorkspaceSourceControl> | ReturnType<typeof workspaceUnmounted>,
    ) =>
      action.type === workspaceUnmounted.type
        ? { context: action.payload[0], cancel: true }
        : action.payload[0],
    function* (
      action: ReturnType<typeof loadWorkspaceSourceControl> | ReturnType<typeof workspaceUnmounted>,
    ): SagaGenerator<void> {
      if (action.type === workspaceUnmounted.type) return;
      const workspaceId = action.payload[0];
      try {
        const repository = yield* call(resolveSourceControlRepository, { workspaceId });
        yield* put(setWorkspaceSourceControl(workspaceId, repository));
        const statusGeneration = generation;
        try {
          const connection = yield* call(sourceControlAuthStatus, repository.connectionId);
          if (generation === statusGeneration) yield* put(setSourceControlConnection(connection));
        } catch {
          // Keep the resolved repository identity when an auth probe is unavailable.
        }
      } catch {
        yield* put(setWorkspaceSourceControl(workspaceId, null));
      }
    },
  );
  yield* takeLeading(configureSourceControlRequested, configure);
  yield* takeLeading(disconnectSourceControlRequested, disconnect);
  let namespace = yield* selectSourceControlRepositoryNamespace.effect();
  yield* takeEvery(
    [selectSourceControlConnection, setSourceControlConnections, setSourceControlConnection],
    function* (): SagaGenerator<void> {
      const next = yield* selectSourceControlRepositoryNamespace.effect();
      if (next === namespace) return;
      namespace = next;
      yield* put(clearGithubRepos());
      yield* put(clearGithubRepoSearch());
    },
  );
}
