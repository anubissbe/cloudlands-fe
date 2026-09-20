/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { consumeSourceControlConfiguration } from '$features/source-control/credential-handoff';
import SourceControlSettings from './SourceControlSettings.svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  busy: false,
  authenticated: false,
  publicGitLabAuthenticated: false,
  provider: 'gitlab' as 'github' | 'gitlab',
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/source-control/source-control-selectors', () => {
  const readable = <T>(value: T) => ({
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      return () => {};
    },
  });
  return {
    selectSourceControlConnections: () =>
      readable([
        {
          id: 'https://github.com',
          provider: 'github',
          instanceUrl: 'https://github.com',
          enabled: true,
          isConfigured: true,
          tokenSource: 'auto',
          user: null,
        },
        {
          id: 'https://gitlab.com',
          provider: 'gitlab',
          instanceUrl: 'https://gitlab.com',
          tokenSource: 'explicit',
          enabled: true,
          isConfigured: mocks.publicGitLabAuthenticated,
          user: mocks.publicGitLabAuthenticated ? { login: 'public-user' } : null,
        },
        {
          id: 'https://git.euraika.net',
          provider: 'gitlab',
          instanceUrl: 'https://git.euraika.net',
          tokenSource: 'explicit',
          enabled: true,
          isConfigured: mocks.authenticated,
          user: mocks.authenticated ? { login: 'bert' } : null,
        },
      ]),
    selectSelectedSourceControlConnectionId: () =>
      readable(mocks.provider === 'github' ? 'https://github.com' : 'https://git.euraika.net'),
    selectSourceControlBusy: () => readable(mocks.busy),
    selectSourceControlError: () => readable(null),
  };
});
vi.mock('./GitHubAuthConnection.svelte', async () => ({
  default: (await import('../ui/__tests__/mocks/Fa.svelte')).default,
}));

describe('GitLab connection settings', () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.busy = false;
    mocks.authenticated = false;
    mocks.publicGitLabAuthenticated = false;
    mocks.provider = 'gitlab';
  });
  afterEach(cleanup);
  it('lists independent server connections and shows the selected GitLab identity', () => {
    render(SourceControlSettings);
    expect(screen.getByRole('combobox', { name: 'Connection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add GitLab server', exact: true })).toBeTruthy();
    expect(screen.getByText('git.euraika.net', { exact: true })).toBeTruthy();
    expect(screen.getByText('Not connected', { exact: true })).toBeTruthy();
  });

  it('connects GitLab inline during onboarding while GitHub is still the active provider', async () => {
    mocks.provider = 'github';
    render(SourceControlSettings, {
      initialProvider: 'gitlab',
      showProviderPicker: false,
      embedded: true,
    });
    expect(screen.queryByRole('radio', { name: 'GitHub', exact: true })).toBeNull();
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://git.euraika.net' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Connect GitLab', exact: true }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'sourceControl/configure',
      payload: [
        { provider: 'gitlab', instanceUrl: 'https://git.euraika.net', tokenSource: 'explicit' },
      ],
    });
  });

  it('keeps the add-server form editable when gitlab.com is already connected', async () => {
    mocks.publicGitLabAuthenticated = true;
    render(SourceControlSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Add GitLab server', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Connection', exact: true }).textContent).toContain(
      'Add GitLab server',
    );
    expect((screen.getByLabelText('GitLab instance URL') as HTMLInputElement).value).toBe(
      'https://gitlab.com',
    );
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://another.example' },
    });
    expect((screen.getByLabelText('GitLab instance URL') as HTMLInputElement).value).toBe(
      'https://another.example',
    );
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it('discards a token draft when starting another server connection', async () => {
    render(SourceControlSettings);
    await fireEvent.input(screen.getByLabelText('Personal access token'), {
      target: { value: 'synthetic-token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add GitLab server', exact: true }));
    expect((screen.getByLabelText('Personal access token') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('combobox', { name: 'Connection', exact: true }).textContent).toContain(
      'Add GitLab server',
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain('synthetic-token');
  });
  it('dispatches the entered self-hosted instance and PAT and clears the password draft', async () => {
    render(SourceControlSettings);
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://git.euraika.net' },
    });
    const password = screen.getByLabelText('Personal access token') as HTMLInputElement;
    await fireEvent.input(password, { target: { value: 'synthetic-test-token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save and test connection' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'sourceControl/configure',
      payload: [
        {
          provider: 'gitlab',
          instanceUrl: 'https://git.euraika.net',
          tokenSource: 'explicit',
        },
      ],
    });
    expect(password.value).toBe('');
    const action = mocks.dispatch.mock.calls.find(
      ([action]) => action.type === 'sourceControl/configure',
    )![0];
    expect(JSON.stringify(action)).not.toContain('synthetic-test-token');
    expect(consumeSourceControlConfiguration(action.payload[0])).toMatchObject({
      token: 'synthetic-test-token',
    });
  });
  it('discards a token draft when its target instance changes', async () => {
    render(SourceControlSettings);
    const password = screen.getByLabelText('Personal access token') as HTMLInputElement;
    await fireEvent.input(password, { target: { value: 'synthetic-test-token' } });
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://another.example' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save and test connection' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'sourceControl/configure',
      payload: [
        {
          provider: 'gitlab',
          instanceUrl: 'https://another.example',
          tokenSource: 'explicit',
        },
      ],
    });
  });
  it('hides the previous connection status after changing the instance URL', async () => {
    mocks.authenticated = true;
    const onConnectionReadyChange = vi.fn();
    render(SourceControlSettings, { onConnectionReadyChange });
    expect(screen.getByText(/Connected as/)).toBeTruthy();
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(true);
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://another.example' },
    });
    expect(screen.queryByText(/Connected as/)).toBeNull();
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(false);
  });

  it('recognizes a verified instance after harmless URL normalization', async () => {
    mocks.authenticated = true;
    const onConnectionReadyChange = vi.fn();
    render(SourceControlSettings, { embedded: true, onConnectionReadyChange });
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://GIT.EURAIKA.NET:443/' },
    });
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Connected as/)).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('GitLab instance URL'), {
      target: { value: 'https://git.euraika.net/another-prefix/' },
    });
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(false);
  });

  it('requires rechecking an edited token before onboarding can continue', async () => {
    mocks.authenticated = true;
    const onConnectionReadyChange = vi.fn();
    render(SourceControlSettings, { embedded: true, onConnectionReadyChange });
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(true);
    await fireEvent.input(screen.getByLabelText('Personal access token'), {
      target: { value: 'synthetic-replacement-token' },
    });
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(/Connected as/)).toBeNull();
  });

  it('disables mutation controls while checking credentials', () => {
    mocks.busy = true;
    mocks.authenticated = true;
    const onConnectionReadyChange = vi.fn();
    render(SourceControlSettings, { onConnectionReadyChange });
    expect(onConnectionReadyChange).toHaveBeenLastCalledWith(false);
    expect(
      (screen.getByRole('button', { name: 'Save and test connection' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Personal access token') as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});
