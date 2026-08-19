/**
 * @vitest-environment jsdom
 *
 * Component tests for ExecutionEnvironmentPicker's flow awareness (worktree
 * is only offerable for the Copy-from-local flow): flow-scoped pickable set,
 * flow-aware preselection fallback, and snap-back to Direct when a flow
 * switch strands a worktree selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { SandboxOptions } from '$shared/schemas';
import ExecutionEnvironmentPicker from '../ExecutionEnvironmentPicker.svelte';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mockInvoke,
}));

/** PROTOCOL §5.5b-shaped `sandbox.options` fixture (worktree default). */
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

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Execution environment' });
}

describe('ExecutionEnvironmentPicker (flow-aware)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ success: true, data: baseOptions });
  });

  afterEach(() => {
    cleanup();
  });

  it('local flow: offers worktree and preselects the worktree default', async () => {
    const onchange = vi.fn();
    render(ExecutionEnvironmentPicker, { props: { flow: 'local', onchange } });

    await waitFor(() => {
      expect(onchange).toHaveBeenCalledWith('worktree');
      expect(trigger().textContent).toContain('Worktree');
    });

    await fireEvent.keyDown(trigger(), { key: 'Enter' });
    const options = await waitFor(() => {
      const found = screen.getAllByRole('option');
      expect(found).toHaveLength(3);
      return found;
    });
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Direct'),
      expect.stringContaining('Worktree'),
      expect.stringContaining('Copy-on-Write'),
    ]);
  });

  it.each(['github', 'new-repo'] as const)(
    '%s flow: filters worktree out and preselects Direct over the worktree default',
    async (flow) => {
      const onchange = vi.fn();
      render(ExecutionEnvironmentPicker, { props: { flow, onchange } });

      await waitFor(() => {
        expect(onchange).toHaveBeenCalledWith('direct');
        expect(trigger().textContent).toContain('Direct');
      });

      await fireEvent.keyDown(trigger(), { key: 'Enter' });
      const options = await waitFor(() => {
        const found = screen.getAllByRole('option');
        expect(found).toHaveLength(2);
        return found;
      });
      expect(options.map((o) => o.textContent)).toEqual([
        expect.stringContaining('Direct'),
        expect.stringContaining('Copy-on-Write'),
      ]);
    },
  );

  it.each(['github', 'new-repo'] as const)(
    'snap-back: switching to the %s flow with worktree selected snaps to Direct',
    async (flow) => {
      const onchange = vi.fn();
      const view = render(ExecutionEnvironmentPicker, { props: { flow: 'local', onchange } });

      await waitFor(() => {
        expect(onchange).toHaveBeenCalledWith('worktree');
      });
      onchange.mockClear();

      await view.rerender({ flow });

      await waitFor(() => {
        expect(onchange).toHaveBeenCalledWith('direct');
        expect(trigger().textContent).toContain('Direct');
      });
    },
  );

  it('non-worktree selection survives a flow switch (no snap-back)', async () => {
    const onchange = vi.fn();
    const view = render(ExecutionEnvironmentPicker, {
      props: { flow: 'local', value: 'cow', onchange },
    });

    await waitFor(() => {
      expect(trigger().textContent).toContain('Copy-on-Write');
    });
    onchange.mockClear();

    await view.rerender({ flow: 'github' });

    // cow stays pickable in the github flow — selection untouched.
    await waitFor(() => {
      expect(trigger().textContent).toContain('Copy-on-Write');
    });
    expect(onchange).not.toHaveBeenCalled();
  });
});
