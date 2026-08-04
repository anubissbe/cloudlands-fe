/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ExecutionEnvironmentSettings from './ExecutionEnvironmentSettings.svelte';
import { SANDBOX_CHANNELS } from '$shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  notificationHandlers: [] as Array<(n: { method: string; params?: unknown }) => void>,
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mocks.mockInvoke,
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.mockSettingsGet,
      update: mocks.mockSettingsUpdate,
    },
  },
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    mocks.notificationHandlers.push(handler);
    return () => {};
  },
}));

/** PROTOCOL §5.5b-shaped `sandbox.options` fixture (Apple Silicon, CoW-capable). */
const baseOptions = {
  defaultType: 'worktree',
  options: [
    { type: 'direct', enabled: true, available: true, default: false },
    { type: 'worktree', enabled: true, available: true, default: true },
    { type: 'cow', enabled: false, available: true, default: false },
    { type: 'microvm', enabled: false, available: true, default: false },
  ],
};

function emitEvent(type: string, data: Record<string, unknown> = {}) {
  for (const handler of mocks.notificationHandlers) {
    handler({ method: 'events.event', params: { event: { type, data } } });
  }
}

describe('ExecutionEnvironmentSettings (§5.5b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandlers.length = 0;
    mocks.mockSettingsGet.mockResolvedValue(null);
    mocks.mockInvoke.mockResolvedValue({ success: true, data: baseOptions });
  });

  afterEach(() => {
    cleanup();
  });

  it('requests the sandbox.options matrix through the sandbox:options channel', async () => {
    render(ExecutionEnvironmentSettings);

    await waitFor(() => {
      expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.OPTIONS, undefined);
    });
  });

  it('renders one row per type with toggles reflecting enabled state', async () => {
    render(ExecutionEnvironmentSettings);

    const toggles = await waitFor(() => {
      const found = screen.getAllByRole('switch');
      expect(found).toHaveLength(4);
      return found;
    });
    expect(toggles.map((t) => t.getAttribute('data-state'))).toEqual(['on', 'on', 'off', 'off']);
    // Enabled types also appear as options in the default selector.
    expect(screen.getAllByText('Direct').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Worktree').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Copy-on-Write')).toHaveLength(1);
    expect(screen.getAllByText('MicroVM')).toHaveLength(1);
  });

  it('disables unavailable rows (toggle off) and renders the structured reason', async () => {
    mocks.mockInvoke.mockResolvedValue({
      success: true,
      data: {
        defaultType: 'worktree',
        options: [
          { type: 'direct', enabled: true, available: true, default: false },
          { type: 'worktree', enabled: true, available: true, default: true },
          {
            type: 'cow',
            enabled: true,
            available: false,
            default: false,
            reason: 'the workspaces root filesystem does not support copy-on-write clones',
          },
          {
            type: 'microvm',
            enabled: false,
            available: false,
            default: false,
            reason: 'the workspaces root filesystem does not support copy-on-write clones',
          },
        ],
      },
    });

    render(ExecutionEnvironmentSettings);

    const toggles = await waitFor(() => {
      const found = screen.getAllByRole('switch');
      expect(found).toHaveLength(4);
      return found;
    });
    // cow is enabled in settings intent but unavailable: rendered off + disabled.
    expect(toggles[2].getAttribute('data-state')).toBe('off');
    expect((toggles[2] as HTMLButtonElement).disabled).toBe(true);
    expect((toggles[3] as HTMLButtonElement).disabled).toBe(true);
    const reasons = screen.getAllByText(
      /the workspaces root filesystem does not support copy-on-write clones/,
    );
    expect(reasons).toHaveLength(2);
  });

  it('sends the exact enable payload via sandbox:profiles:update on toggle', async () => {
    render(ExecutionEnvironmentSettings);

    const toggles = await waitFor(() => {
      const found = screen.getAllByRole('switch');
      expect(found).toHaveLength(4);
      return found;
    });
    await fireEvent.click(toggles[2]); // cow: enabled false → true

    await waitFor(() => {
      expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
        profiles: { cow: { enabled: true } },
      });
    });
  });

  it('sends defaultType via sandbox:profiles:update when the default selector changes', async () => {
    render(ExecutionEnvironmentSettings);

    const select = (await screen.findByLabelText('Default environment')) as HTMLSelectElement;
    // Only enabled types are offered.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['direct', 'worktree']);

    await fireEvent.change(select, { target: { value: 'direct' } });

    await waitFor(() => {
      expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
        defaultType: 'direct',
      });
    });
  });

  it('surfaces the daemon validation error when an update is rejected (nothing applied)', async () => {
    mocks.mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === SANDBOX_CHANNELS.PROFILES_UPDATE) {
        return { success: false, error: 'defaultType names a disabled type' };
      }
      return { success: true, data: baseOptions };
    });

    render(ExecutionEnvironmentSettings);

    const toggles = await waitFor(() => {
      const found = screen.getAllByRole('switch');
      expect(found).toHaveLength(4);
      return found;
    });
    await fireEvent.click(toggles[2]);

    await waitFor(() => {
      expect(screen.getByText('defaultType names a disabled type')).toBeTruthy();
    });
  });

  it('marks the default row with a Default badge', async () => {
    render(ExecutionEnvironmentSettings);

    await waitFor(() => {
      expect(screen.getByText('Default')).toBeTruthy();
    });
  });

  describe('microVM extras (enabled + available)', () => {
    const microvmOnOptions = {
      defaultType: 'worktree',
      options: [
        { type: 'direct', enabled: true, available: true, default: false },
        { type: 'worktree', enabled: true, available: true, default: true },
        { type: 'cow', enabled: true, available: true, default: false },
        { type: 'microvm', enabled: true, available: true, default: false },
      ],
    };

    beforeEach(() => {
      mocks.mockInvoke.mockResolvedValue({ success: true, data: microvmOnOptions });
    });

    it('shows the claude-code not-set-up state when the token setting is absent', async () => {
      mocks.mockSettingsGet.mockResolvedValue(null);

      render(ExecutionEnvironmentSettings);

      await waitFor(() => {
        expect(mocks.mockSettingsGet).toHaveBeenCalledWith('providers.claudeCodeOauthToken');
        expect(
          screen.getByText(/needs a one-time long-lived token to run inside microVMs/),
        ).toBeTruthy();
      });
      expect(screen.getByText('Set up')).toBeTruthy();
    });

    it('shows the ready state when the sensitive token reads back as a redacted placeholder', async () => {
      mocks.mockSettingsGet.mockResolvedValue({
        path: 'providers.claudeCodeOauthToken',
        value: '••••••••',
      });

      render(ExecutionEnvironmentSettings);

      await waitFor(() => {
        expect(screen.getByText(/Token saved — Claude Code is ready/)).toBeTruthy();
      });
      expect(screen.getByText('Replace token')).toBeTruthy();
    });

    it('saves a pasted token to the sensitive setting and flips to ready', async () => {
      mocks.mockSettingsGet.mockResolvedValue(null);
      mocks.mockSettingsUpdate.mockResolvedValue([
        { path: 'providers.claudeCodeOauthToken', value: '••••••••' },
      ]);

      render(ExecutionEnvironmentSettings);

      const setup = await screen.findByText('Set up');
      await fireEvent.click(setup);

      const input = await screen.findByLabelText('Claude Code OAuth token');
      await fireEvent.input(input, { target: { value: 'sk-ant-oat01-abc' } });
      await fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'providers.claudeCodeOauthToken', value: 'sk-ant-oat01-abc' },
        ]);
        expect(screen.getByText(/Token saved — Claude Code is ready/)).toBeTruthy();
      });
    });

    it('flips to token-rejected with the daemon message when the save is rejected', async () => {
      mocks.mockSettingsGet.mockResolvedValue(null);
      mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('token failed validation'));

      render(ExecutionEnvironmentSettings);

      const setup = await screen.findByText('Set up');
      await fireEvent.click(setup);

      const input = await screen.findByLabelText('Claude Code OAuth token');
      await fireEvent.input(input, { target: { value: 'bad-token' } });
      await fireEvent.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(screen.getByText(/The token was rejected/)).toBeTruthy();
        expect(screen.getByText('token failed validation')).toBeTruthy();
      });
    });

    it('renders the guest-image download lifecycle from sandbox:image:* events', async () => {
      render(ExecutionEnvironmentSettings);

      await waitFor(() => {
        expect(screen.getAllByRole('switch')).toHaveLength(4);
      });

      emitEvent('sandbox:image:pulling', { manifestUrl: 'https://example.test/m.json' });
      await waitFor(() => {
        expect(screen.getByText('Downloading guest image…')).toBeTruthy();
      });

      emitEvent('sandbox:image:downloaded', {
        manifestUrl: 'https://example.test/m.json',
        imageId: 'guest',
        version: '1.2.3',
        sha256: 'abc',
        cachePath: '/tmp/cache',
      });
      await waitFor(() => {
        expect(screen.getByText(/Guest image 1\.2\.3 downloaded and verified/)).toBeTruthy();
      });

      emitEvent('sandbox:image:error', {
        manifestUrl: 'https://example.test/m.json',
        configSource: 'built-in pin',
        error: 'checksum mismatch',
      });
      await waitFor(() => {
        expect(screen.getByText(/Guest image download failed: checksum mismatch/)).toBeTruthy();
      });
    });
  });
});
