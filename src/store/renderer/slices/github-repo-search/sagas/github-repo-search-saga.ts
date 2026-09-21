import { selectSelectedSourceControlConnectionId } from '$store/renderer/slices/source-control/source-control-selectors';
import { call, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GithubRepo } from '$features/github-auth/types';
import {
  clearGithubRepoSearch,
  searchGithubRepos,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from '../github-repo-search-slice';
import { selectSourceControlRepositoryNamespace } from '../../github-auth/github-auth-selectors';
import type { GithubRepoItem } from '../../github-repos/github-repos-slice';

export const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const UNKNOWN_SEARCH_ERROR = 'Unknown error'; // i18n-ignore (wire-error normalization)

function normalizeRepo(repo: GithubRepo): GithubRepoItem {
  return {
    id: `${repo.owner}/${repo.name}`,
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
    ...(repo.html_url ? { htmlUrl: repo.html_url } : {}),
  };
}

function* searchGithubReposWorker(
  action: ReturnType<typeof searchGithubRepos> | ReturnType<typeof clearGithubRepoSearch>,
): SagaGenerator<void> {
  if (action.type === clearGithubRepoSearch.type) return;
  const namespace = yield* selectSourceControlRepositoryNamespace.effect();
  const connectionId = yield* selectSelectedSourceControlConnectionId.effect();
  const query = (action as ReturnType<typeof searchGithubRepos>).payload[0].trim();
  if (query.length < MIN_QUERY_LENGTH) {
    yield* put(clearGithubRepoSearch());
    return;
  }

  yield* delay(SEARCH_DEBOUNCE_MS);
  if (namespace !== (yield* selectSourceControlRepositoryNamespace.effect())) return;
  yield* put(setGithubRepoSearchLoading(query));
  const result: Awaited<ReturnType<typeof githubAuthClient.searchRepos>> = yield* call(
    [githubAuthClient, githubAuthClient.searchRepos],
    query,
    { connectionId },
  );
  if (namespace !== (yield* selectSourceControlRepositoryNamespace.effect())) return;
  if (!result.success) {
    yield* put(setGithubRepoSearchError(query, result.error ?? UNKNOWN_SEARCH_ERROR));
    return;
  }
  yield* put(setGithubRepoSearchResults(query, (result.data ?? []).map(normalizeRepo)));
}

export function* githubRepoSearchSaga(): SagaGenerator<void> {
  yield* takeLatest([searchGithubRepos, clearGithubRepoSearch], searchGithubReposWorker);
}
