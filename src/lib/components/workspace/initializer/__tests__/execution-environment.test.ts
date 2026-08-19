/**
 * @vitest-environment jsdom
 *
 * Unit tests for the creation-picker execution-environment helpers
 * (PROTOCOL §5.5b `sandbox.options` / §5.1 v3.3 `executionEnvironment`),
 * extending the isolation-mode.test.ts patterns: the wire request goes
 * through the SANDBOX_CHANNELS.OPTIONS bridge channel, responses are
 * PROTOCOL-shaped fixtures, and failures degrade to `null` (picker hidden,
 * legacy flow untouched) — never to a silently wrong catalog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_CHANNELS } from '$shared/ipc/channels';
import type { SandboxOptions } from '$shared/schemas';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mockInvoke,
}));

import {
  environmentLabel,
  loadExecutionEnvironmentOptions,
  pickableEnvironments,
  preselectedEnvironment,
} from '../execution-environment';

/** PROTOCOL §5.5b-shaped `sandbox.options` fixture (Apple Silicon, CoW-capable). */
const baseOptions: SandboxOptions = {
  defaultType: 'worktree',
  options: [
    { type: 'direct', enabled: true, available: true, default: false },
    { type: 'worktree', enabled: true, available: true, default: true },
    { type: 'cow', enabled: true, available: true, default: false },
    {
      type: 'microvm',
      enabled: false,
      available: false,
      default: false,
      reason: 'requires Apple Silicon',
    },
  ],
};

describe('loadExecutionEnvironmentOptions', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('requests the sandbox:options bridge channel (§5.5b, no params)', async () => {
    mockInvoke.mockResolvedValue({ success: true, data: baseOptions });
    const result = await loadExecutionEnvironmentOptions();
    expect(mockInvoke).toHaveBeenCalledWith(SANDBOX_CHANNELS.OPTIONS, undefined);
    expect(result).toEqual(baseOptions);
  });

  it('bridge failure envelope → null (picker hidden, no fallback catalog)', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'method not found' });
    await expect(loadExecutionEnvironmentOptions()).resolves.toBeNull();
  });

  it('transport rejection → null (older daemon without §5.5b)', async () => {
    mockInvoke.mockRejectedValue(new Error('wire down'));
    await expect(loadExecutionEnvironmentOptions()).resolves.toBeNull();
  });
});

describe('pickableEnvironments', () => {
  it('offers only enabled AND available types, in catalog order', () => {
    expect(pickableEnvironments(baseOptions)).toEqual(['direct', 'worktree', 'cow']);
  });

  it('excludes enabled-but-unavailable types (no silent availability healing)', () => {
    const options: SandboxOptions = {
      defaultType: 'worktree',
      options: [
        { type: 'direct', enabled: true, available: true, default: false },
        { type: 'worktree', enabled: true, available: true, default: true },
        { type: 'cow', enabled: true, available: false, default: false, reason: 'no CoW FS' },
        { type: 'microvm', enabled: true, available: false, default: false, reason: 'no CoW FS' },
      ],
    };
    expect(pickableEnvironments(options)).toEqual(['direct', 'worktree']);
  });

  it('flow matrix: local offers worktree; github/new-repo filter it out client-side', () => {
    expect(pickableEnvironments(baseOptions, 'local')).toEqual(['direct', 'worktree', 'cow']);
    expect(pickableEnvironments(baseOptions, 'github')).toEqual(['direct', 'cow']);
    expect(pickableEnvironments(baseOptions, 'new-repo')).toEqual(['direct', 'cow']);
  });

  it('non-local flows still honor enabled+available for the remaining types', () => {
    const options: SandboxOptions = {
      defaultType: 'worktree',
      options: [
        { type: 'direct', enabled: true, available: true, default: false },
        { type: 'worktree', enabled: true, available: true, default: true },
        { type: 'cow', enabled: true, available: false, default: false, reason: 'no CoW FS' },
        { type: 'microvm', enabled: false, available: true, default: false },
      ],
    };
    expect(pickableEnvironments(options, 'github')).toEqual(['direct']);
    expect(pickableEnvironments(options, 'new-repo')).toEqual(['direct']);
  });
});

describe('preselectedEnvironment', () => {
  it('preselects the profile default when pickable', () => {
    expect(preselectedEnvironment(baseOptions)).toBe('worktree');
  });

  it('falls back to the first pickable type when the default is not pickable', () => {
    const options: SandboxOptions = {
      defaultType: 'cow',
      options: [
        { type: 'direct', enabled: true, available: true, default: false },
        { type: 'worktree', enabled: true, available: true, default: false },
        { type: 'cow', enabled: true, available: false, default: true, reason: 'no CoW FS' },
        { type: 'microvm', enabled: false, available: false, default: false, reason: 'no CoW FS' },
      ],
    };
    expect(preselectedEnvironment(options)).toBe('direct');
  });

  it('returns null when nothing is pickable (picker hidden)', () => {
    const options: SandboxOptions = {
      defaultType: 'direct',
      options: [
        { type: 'direct', enabled: false, available: true, default: true },
        { type: 'worktree', enabled: false, available: true, default: false },
        { type: 'cow', enabled: false, available: false, default: false, reason: 'no CoW FS' },
        { type: 'microvm', enabled: false, available: false, default: false, reason: 'no CoW FS' },
      ],
    };
    expect(preselectedEnvironment(options)).toBeNull();
  });

  it('worktree default in a github/new-repo flow falls back to Direct', () => {
    expect(preselectedEnvironment(baseOptions, 'local')).toBe('worktree');
    expect(preselectedEnvironment(baseOptions, 'github')).toBe('direct');
    expect(preselectedEnvironment(baseOptions, 'new-repo')).toBe('direct');
  });

  it('non-worktree default stays preselected in non-local flows when pickable', () => {
    const options: SandboxOptions = {
      ...baseOptions,
      defaultType: 'cow',
    };
    expect(preselectedEnvironment(options, 'github')).toBe('cow');
    expect(preselectedEnvironment(options, 'new-repo')).toBe('cow');
  });

  it('returns null when a flow filters out every pickable type (picker hidden)', () => {
    const options: SandboxOptions = {
      defaultType: 'worktree',
      options: [
        { type: 'direct', enabled: false, available: true, default: false },
        { type: 'worktree', enabled: true, available: true, default: true },
        { type: 'cow', enabled: false, available: false, default: false, reason: 'no CoW FS' },
        { type: 'microvm', enabled: false, available: false, default: false, reason: 'no CoW FS' },
      ],
    };
    expect(preselectedEnvironment(options, 'local')).toBe('worktree');
    expect(preselectedEnvironment(options, 'github')).toBeNull();
    expect(preselectedEnvironment(options, 'new-repo')).toBeNull();
  });
});

describe('environmentLabel', () => {
  it('maps every type to human copy', () => {
    expect(environmentLabel('direct')).toBe('Direct');
    expect(environmentLabel('worktree')).toBe('Worktree');
    expect(environmentLabel('cow')).toBe('Copy-on-Write');
    expect(environmentLabel('microvm')).toBe('MicroVM');
  });
});
