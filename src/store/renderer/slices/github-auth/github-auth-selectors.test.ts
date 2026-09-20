import { describe, expect, it } from 'vitest';
import { selectGitHubAuthIsAuthenticated } from './github-auth-selectors';
import { initialState } from './github-auth-slice';
import {
  sourceControlReducer,
  initialState as sourceInitialState,
  setSourceControlConnections,
  selectSourceControlConnection,
} from '../source-control/source-control-slice';
import {
  selectSourceControlIsAuthenticated,
  selectWorkspaceSourceControlIsAuthenticated,
} from '../source-control/source-control-selectors';
describe('independent source-control authentication', () => {
  it('keeps GitHub authenticated while browsing a different GitLab connection', () => {
    const id = 'https://git.example';
    const sourceControl = sourceControlReducer(
      sourceControlReducer(
        sourceInitialState,
        setSourceControlConnections([
          {
            id,
            provider: 'gitlab',
            instanceUrl: id,
            enabled: true,
            isConfigured: true,
            tokenSource: 'explicit',
            user: null,
          },
        ]),
      ),
      selectSourceControlConnection(id),
    );
    const state = {
      githubAuth: { ...initialState, isAuthenticated: true },
      sourceControl,
    } as never;
    expect(selectGitHubAuthIsAuthenticated.select(state)).toBe(true);
    expect(selectSourceControlIsAuthenticated.select(state)).toBe(true);
    expect(selectWorkspaceSourceControlIsAuthenticated.select(state, 'unknown-workspace')).toBe(
      false,
    );
  });
});
