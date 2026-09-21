import { describe, expect, it } from 'vitest';
import {
  githubAuthReducer,
  initialState,
  setGitHubAuthState,
  logoutCompleted,
} from './github-auth-slice';
describe('GitHub authentication reducer', () => {
  it('starts disconnected and clears GitHub identity on logout', () => {
    expect(initialState.isAuthenticated).toBe(false);
    const connected = githubAuthReducer(
      initialState,
      setGitHubAuthState({
        isAuthenticated: true,
        requiresDaemonAuth: false,
        needsScopeUpdate: false,
        oauthUrl: null,
        user: { login: 'bert', name: null, email: null, avatar_url: '' },
      }),
    );
    expect(connected.isAuthenticated).toBe(true);
    const disconnected = githubAuthReducer(connected, logoutCompleted());
    expect(disconnected.isAuthenticated).toBe(false);
    expect(disconnected.user).toBeNull();
  });
});
