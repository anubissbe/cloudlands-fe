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

/** PROTOCOL §5.5b-shaped `sandbox.profiles.list` fixture (default sizing, no override). */
const baseProfiles = {
  defaultType: 'worktree',
  profiles: [
    { type: 'direct', enabled: true },
    { type: 'worktree', enabled: true },
    { type: 'cow', enabled: false },
    { type: 'microvm', enabled: false, image: null, vcpus: 2, memMib: 2048 },
  ],
};

/** Channel-aware default mock: options matrix + configured profiles. */
function mockChannels(
  overrides: Partial<Record<string, unknown>> = {},
): (channel: string, arg?: unknown) => Promise<unknown> {
  return async (channel: string) => {
    if (channel in overrides) return overrides[channel];
    if (channel === SANDBOX_CHANNELS.OPTIONS) return { success: true, data: baseOptions };
    if (channel === SANDBOX_CHANNELS.PROFILES_LIST) return { success: true, data: baseProfiles };
    return { success: true, data: baseProfiles };
  };
}

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
    mocks.mockInvoke.mockImplementation(mockChannels());
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

    const trigger = await waitFor(() =>
      screen.getByRole('button', { name: /Default environment/ }),
    );
    expect(trigger.textContent).toContain('Worktree');

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    // Only enabled types are offered (direct, worktree); current is worktree.
    const options = await waitFor(() => {
      const found = screen.getAllByRole('option');
      expect(found).toHaveLength(2);
      return found;
    });
    expect(options.map((o) => o.textContent?.trim().split(/\s/)[0])).toEqual([
      'Direct',
      'Worktree',
    ]);
    await fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });

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
    const microvmOnProfiles = {
      defaultType: 'worktree',
      profiles: [
        { type: 'direct', enabled: true },
        { type: 'worktree', enabled: true },
        { type: 'cow', enabled: true },
        { type: 'microvm', enabled: true, image: null, vcpus: 4, memMib: 4096 },
      ],
    };

    beforeEach(() => {
      mocks.mockInvoke.mockImplementation(
        mockChannels({
          [SANDBOX_CHANNELS.OPTIONS]: { success: true, data: microvmOnOptions },
          [SANDBOX_CHANNELS.PROFILES_LIST]: { success: true, data: microvmOnProfiles },
        }),
      );
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

    it('seeds the sizing inputs from sandbox.profiles.list and commits changes via profiles.update', async () => {
      render(ExecutionEnvironmentSettings);

      const vcpus = (await screen.findByLabelText('vCPUs')) as HTMLInputElement;
      const memMib = (await screen.findByLabelText('Memory (MiB)')) as HTMLInputElement;
      // Seeded from the microvm profile row (vcpus: 4, memMib: 4096).
      expect(vcpus.value).toBe('4');
      expect(memMib.value).toBe('4096');

      await fireEvent.input(vcpus, { target: { value: '8' } });
      await fireEvent.change(vcpus);
      await waitFor(() => {
        expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
          profiles: { microvm: { vcpus: 8 } },
        });
      });

      await fireEvent.input(memMib, { target: { value: '8192' } });
      await fireEvent.change(memMib);
      await waitFor(() => {
        expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
          profiles: { microvm: { memMib: 8192 } },
        });
      });
    });

    it('shows the built-in image state when no override is configured', async () => {
      render(ExecutionEnvironmentSettings);

      await waitFor(() => {
        expect(screen.getByText('Using the built-in default image.')).toBeTruthy();
      });
      // No override → no reset action.
      expect(screen.queryByText('Reset to default')).toBeNull();
    });

    it('checks a manifest URL via sandbox:image:check and persists the pinned override on valid', async () => {
      mocks.mockInvoke.mockImplementation(
        mockChannels({
          [SANDBOX_CHANNELS.OPTIONS]: { success: true, data: microvmOnOptions },
          [SANDBOX_CHANNELS.PROFILES_LIST]: { success: true, data: microvmOnProfiles },
          [SANDBOX_CHANNELS.IMAGE_CHECK]: {
            success: true,
            data: {
              valid: true,
              imageId: 'intent-guest-base',
              version: '2.0.0',
              arch: 'aarch64',
              manifestSha256: 'a'.repeat(64),
            },
          },
        }),
      );

      render(ExecutionEnvironmentSettings);

      const input = (await screen.findByLabelText(
        'Guest image manifest URL',
      )) as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'https://example.test/m.json' } });
      await fireEvent.click(screen.getByText('Check & save'));

      await waitFor(() => {
        expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.IMAGE_CHECK, {
          manifestUrl: 'https://example.test/m.json',
        });
        // Valid → persisted with the checked document's sha as the pin.
        expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
          profiles: {
            microvm: {
              image: { manifestUrl: 'https://example.test/m.json', sha256: 'a'.repeat(64) },
            },
          },
        });
        expect(screen.getByText(/Valid: intent-guest-base 2\.0\.0 \(aarch64\)/)).toBeTruthy();
      });
    });

    it('surfaces an invalid check result and does not persist', async () => {
      mocks.mockInvoke.mockImplementation(
        mockChannels({
          [SANDBOX_CHANNELS.OPTIONS]: { success: true, data: microvmOnOptions },
          [SANDBOX_CHANNELS.PROFILES_LIST]: { success: true, data: microvmOnProfiles },
          [SANDBOX_CHANNELS.IMAGE_CHECK]: {
            success: true,
            data: { valid: false, error: 'failed to fetch image manifest' },
          },
        }),
      );

      render(ExecutionEnvironmentSettings);

      const input = (await screen.findByLabelText(
        'Guest image manifest URL',
      )) as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'https://bad.test/m.json' } });
      await fireEvent.click(screen.getByText('Check & save'));

      await waitFor(() => {
        expect(screen.getByText(/Invalid image: failed to fetch image manifest/)).toBeTruthy();
      });
      expect(mocks.mockInvoke).not.toHaveBeenCalledWith(
        SANDBOX_CHANNELS.PROFILES_UPDATE,
        expect.anything(),
      );
    });

    it('resets a configured override back to the built-in default (explicit image: null)', async () => {
      const overrideProfiles = {
        defaultType: 'worktree',
        profiles: [
          { type: 'direct', enabled: true },
          { type: 'worktree', enabled: true },
          { type: 'cow', enabled: true },
          {
            type: 'microvm',
            enabled: true,
            image: { manifestUrl: 'https://example.test/m.json', sha256: 'b'.repeat(64) },
            vcpus: 4,
            memMib: 4096,
          },
        ],
      };
      mocks.mockInvoke.mockImplementation(
        mockChannels({
          [SANDBOX_CHANNELS.OPTIONS]: { success: true, data: microvmOnOptions },
          [SANDBOX_CHANNELS.PROFILES_LIST]: { success: true, data: overrideProfiles },
        }),
      );

      render(ExecutionEnvironmentSettings);

      await waitFor(() => {
        expect(screen.getByText('Using a custom image manifest.')).toBeTruthy();
      });
      const input = (await screen.findByLabelText(
        'Guest image manifest URL',
      )) as HTMLInputElement;
      expect(input.value).toBe('https://example.test/m.json');

      await fireEvent.click(screen.getByText('Reset to default'));

      await waitFor(() => {
        expect(mocks.mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.PROFILES_UPDATE, {
          profiles: { microvm: { image: null } },
        });
      });
    });
  });
});
