/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import GitWorkspaceSettings from './GitWorkspaceSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockCapabilities: vi.fn(),
  mockDispatch: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.mockSettingsList,
      update: mocks.mockSettingsUpdate,
    },
    system: {
      capabilities: mocks.mockCapabilities,
    },
  },
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.mockDispatch },
}));

vi.mock('$store/renderer/slices/workspace-settings/workspace-settings-slice', () => ({
  refreshAutoCommitSettings: () => ({ type: 'workspaceSettings/refreshAutoCommitSettings' }),
}));

const GIT_CRED_PATH = 'sourceControl.github.exposeGitCredentialToChildren';
const GIT_CRED_LABEL = /Git credentials in terminals & agents/;

const baseSettings = [
  { path: 'workspace.worktreesLocation', value: '' },
  { path: 'workspace.sshKeyPath', value: '' },
  { path: 'workspace.defaultShell', value: 'auto' },
  { path: 'workspace.autoFetch', value: false },
  { path: 'git.autoCommit', value: true },
  { path: 'workspace.branchPrefix', value: '' },
];

describe('GitWorkspaceSettings — git credential toggle (§5.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the toggle checked when the daemon reports the setting as true', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
    );
    expect(toggle.checked).toBe(true);
  });

  it('renders the toggle unchecked when the daemon reports the setting as false', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: false },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
    );
    expect(toggle.checked).toBe(false);
  });

  it('renders the toggle unchecked when the daemon reports a non-boolean value (fail-safe)', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: null },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
    );
    expect(toggle.checked).toBe(false);
  });

  it('hides the toggle when the daemon does not report the setting (older daemon)', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);

    render(GitWorkspaceSettings);

    // Wait for load to settle (a sibling toggle is rendered), then assert absence.
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Auto-fetch updates/ })).toBeTruthy();
    });
    expect(screen.queryByRole('checkbox', { name: GIT_CRED_LABEL })).toBeNull();
  });

  it('persists a toggle-off via settings.update with the exact payload', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: GIT_CRED_PATH, value: false }]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: GIT_CRED_PATH, value: false },
      ]);
    });
  });

  it('surfaces a save error when settings.update rejects', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);
    mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('boom'));

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Failed to save settings. Please try again.')).toBeTruthy();
    });
  });

  it('shows the git-credential description as a visible subheading, not a title tooltip', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    const description = screen.getByText(/credential helper scoped to HTTPS\s+github\.com remotes/);
    expect(description).toBeTruthy();
    expect(description.closest('[title]')).toBeNull();
    expect(description.id).toBe('git-credentials-description');
    expect(toggle.getAttribute('aria-describedby')).toBe('git-credentials-description');
  });
});

describe('GitWorkspaceSettings — legacy CoW toggle removed (§5.5b migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('never renders the CoW checkbox — its intent moved to the Execution Environments section', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: 'workspace.cowIsolation', value: true },
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: GIT_CRED_LABEL })).toBeTruthy();
    });
    expect(screen.queryByRole('checkbox', { name: /Use Copy-on-Write isolation/ })).toBeNull();
    expect(screen.queryByText('Experimental')).toBeNull();
  });

  it('resetToDefaults never writes workspace.cowIsolation', async () => {
    // autoFetch loads as non-default true so the reset produces a real
    // settings.update batch to inspect.
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings.filter((setting) => setting.path !== 'workspace.autoFetch'),
      { path: 'workspace.autoFetch', value: true },
      { path: 'workspace.cowIsolation', value: true },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([]);

    const { component } = render(GitWorkspaceSettings);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Auto-fetch updates/ })).toBeTruthy();
    });

    component.resetToDefaults();

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalled();
    });
    const changes = mocks.mockSettingsUpdate.mock.calls.flat(2) as Array<{ path: string }>;
    expect(changes.some((change) => change.path === 'workspace.cowIsolation')).toBe(false);
  });
});
