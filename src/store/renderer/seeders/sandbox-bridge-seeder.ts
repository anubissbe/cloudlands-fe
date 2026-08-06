/**
 * Sandbox IPC bridge — routes the renderer's `sandbox:*` channels to the
 * daemon's execution-environment profile surface (`sandbox.profiles.list` /
 * `sandbox.profiles.update` / `sandbox.options` / `sandbox.image.check`,
 * PROTOCOL §5.5b).
 *
 * All four RPCs are daemon-global (no workspaceId). Responses are validated
 * against the shared Zod schemas (BE = source of truth: shapes that diverge
 * from PROTOCOL §5.5b are surfaced as errors, never healed client-side) and
 * wrapped in the `{ success, data } | { success:false, error }` envelope the
 * settings/creation-flow call sites consume.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import {
  SandboxImageCheckSchema,
  SandboxOptionsSchema,
  SandboxProfilesSchema,
} from "$shared/schemas";
import { backendRequest } from "$lib/client/live/backend-transport";

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
}

/** `sandbox:profiles:list` → daemon `sandbox.profiles.list`. */
registerMockIpcHandler(IPC_CHANNELS.SANDBOX.PROFILES_LIST, async () => {
  try {
    const result = await backendRequest("sandbox.profiles.list");
    const parsed = SandboxProfilesSchema.parse(result);
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/**
 * `sandbox:profiles:update` → daemon `sandbox.profiles.update`. Forwards
 * `{ defaultType?, profiles? }` verbatim; a daemon `-32602` validation
 * rejection (unknown type/field, image on a non-microvm type, defaultType
 * naming a disabled type) applies nothing and surfaces as `{ success:false }`.
 */
registerMockIpcHandler(IPC_CHANNELS.SANDBOX.PROFILES_UPDATE, async (arg) => {
  const params = asRecord(arg);
  const daemonParams: Record<string, unknown> = {};
  if (params.defaultType !== undefined) daemonParams.defaultType = params.defaultType;
  if (params.profiles !== undefined) daemonParams.profiles = params.profiles;
  try {
    const result = await backendRequest("sandbox.profiles.update", daemonParams);
    const parsed = SandboxProfilesSchema.parse(result);
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** `sandbox:options` → daemon `sandbox.options` (capability-resolved matrix). */
registerMockIpcHandler(IPC_CHANNELS.SANDBOX.OPTIONS, async () => {
  try {
    const result = await backendRequest("sandbox.options");
    const parsed = SandboxOptionsSchema.parse(result);
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/**
 * `sandbox:image:check` → daemon `sandbox.image.check` (v3.4). Dry-run
 * guest-image validity check: fetch/validation failures come back as
 * `{ valid: false, error }` results (never RPC errors), so only transport
 * failures and a missing `manifestUrl` (-32602) surface as `{ success:false }`.
 */
registerMockIpcHandler(IPC_CHANNELS.SANDBOX.IMAGE_CHECK, async (arg) => {
  const params = asRecord(arg);
  const daemonParams: Record<string, unknown> = { manifestUrl: params.manifestUrl };
  if (params.sha256 !== undefined) daemonParams.sha256 = params.sha256;
  try {
    const result = await backendRequest("sandbox.image.check", daemonParams);
    const parsed = SandboxImageCheckSchema.parse(result);
    return { success: true, data: parsed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});
