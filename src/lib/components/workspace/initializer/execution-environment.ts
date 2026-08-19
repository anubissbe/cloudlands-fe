/**
 * Execution-environment options for the workspace-creation picker.
 *
 * The daemon owns the catalog (`sandbox.options`, PROTOCOL §5.5b): a
 * capability-resolved availability matrix joining settings intent (`enabled`)
 * with what the host can run (`available`), plus the preselected
 * `defaultType`. The picker offers only enabled+available types; selection is
 * threaded into `workspace.create` as `executionEnvironment` (§5.1, v3.3).
 */
import { invoke } from '$shared/generated/ipc-client';
import { SANDBOX_CHANNELS } from '$shared/ipc/channels';
import type { SandboxOptions, SandboxType } from '$shared/schemas';
import { m } from '$shared/paraglide/messages.js';

/** `{ success, data } | { success:false, error }` envelope from the sandbox IPC bridge. */
type SandboxEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error?: string };

/**
 * Fetch the capability-resolved execution-environment matrix. Returns `null`
 * when the surface is unavailable (older daemon without §5.5b, transport
 * failure) so callers fall back to the legacy skip-isolation-only flow —
 * absence of the picker, never a silently wrong picker.
 */
export async function loadExecutionEnvironmentOptions(): Promise<SandboxOptions | null> {
  try {
    const result = await invoke<SandboxEnvelope<SandboxOptions>>(
      SANDBOX_CHANNELS.OPTIONS,
      undefined,
    );
    if (!result || result.success !== true) return null;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Creation flow driving which environments are offerable: worktree needs an
 * existing local checkout to link against, so it is only pickable for
 * "Copy from local" (`local`) — never for "Pick a repo" (`github`) or
 * "New repo" (`new-repo`), where CoW is just how the checkout is obtained.
 */
export type CreationFlow = 'local' | 'github' | 'new-repo';

/**
 * Types offerable at creation: enabled in settings AND available on the host,
 * in the daemon's catalog order (direct, worktree, cow, microvm). Worktree is
 * additionally filtered out for the `github` / `new-repo` flows (the daemon
 * rejects worktree combined with `githubUrl` / `isNewRepo`).
 */
export function pickableEnvironments(
  options: SandboxOptions,
  flow: CreationFlow = 'local',
): SandboxType[] {
  const pickable = options.options
    .filter((row) => row.enabled && row.available)
    .map((row) => row.type);
  return flow === 'local' ? pickable : pickable.filter((type) => type !== 'worktree');
}

/**
 * The type to preselect for a flow: the profile default when it is pickable
 * in that flow; a worktree default in a `github` / `new-repo` flow falls back
 * to Direct; else the first pickable type; else `null` (nothing offerable —
 * picker hidden).
 */
export function preselectedEnvironment(
  options: SandboxOptions,
  flow: CreationFlow = 'local',
): SandboxType | null {
  const pickable = pickableEnvironments(options, flow);
  if (pickable.length === 0) return null;
  if (pickable.includes(options.defaultType)) return options.defaultType;
  if (options.defaultType === 'worktree' && pickable.includes('direct')) return 'direct';
  return pickable[0];
}

/** Human label for an execution-environment type. */
export function environmentLabel(type: SandboxType): string {
  switch (type) {
    case 'direct':
      return m.workspaceInitializer_executionEnvironment_direct_label();
    case 'worktree':
      return m.workspaceInitializer_executionEnvironment_worktree_label();
    case 'cow':
      return m.workspaceInitializer_executionEnvironment_cow_label();
    case 'microvm':
      return m.workspaceInitializer_executionEnvironment_microvm_label();
  }
}

/** Short description for an execution-environment type (picker rows). */
export function environmentDescription(type: SandboxType): string {
  switch (type) {
    case 'direct':
      return m.workspaceInitializer_executionEnvironment_direct_description();
    case 'worktree':
      return m.workspaceInitializer_executionEnvironment_worktree_description();
    case 'cow':
      return m.workspaceInitializer_executionEnvironment_cow_description();
    case 'microvm':
      return m.workspaceInitializer_executionEnvironment_microvm_description();
  }
}
