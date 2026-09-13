<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * Execution Environment Settings (Settings ▸ Setup, PROTOCOL §5.5b).
   *
   * Daemon-backed settings panel (same direct-call pattern as
   * WebSocketApiSettings): reads/writes flow through the sandbox.* RPC
   * bridge + settings client; nothing here is Redux domain state.
   *
   * Renders the four execution-environment types (direct / worktree / cow /
   * microvm) from the capability-resolved `sandbox.options` matrix: enable
   * toggles, availability with the daemon's structured reason on unavailable
   * rows, and the default-environment selector. Replaces the legacy
   * `workspace.cowIsolation` checkbox (its intent is the `cow` profile row).
   *
   * The microVM row additionally surfaces the guest-image download state
   * (`sandbox:image:*` events) and the one-time claude-code setup-token
   * action (issue #1120): not-set-up / ready / token-rejected, backed by the
   * sensitive `providers.claudeCodeOauthToken` setting (reads are redacted —
   * any non-null value means a token is stored).
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { invoke } from '$shared/generated/ipc-client';
  import { SANDBOX_CHANNELS } from '$shared/ipc/channels';
  import type {
    SandboxImageCheck,
    SandboxOptions,
    SandboxProfiles,
    SandboxType,
  } from '$shared/schemas';
  import { appClient } from '$lib/client';
  import { onBackendNotification } from '$lib/client/live/backend-transport';
  import { Toggle } from '$lib/components/ui/toggle';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';

  const CLAUDE_TOKEN_PATH = 'providers.claudeCodeOauthToken';

  // Mirrors the daemon's sandbox.microvm.vcpus / memMib bounds (§5.12).
  const MIN_VCPUS = 1;
  const MAX_VCPUS = 16;
  const MIN_MEM_MIB = 128;

  interface SandboxEnvelope<T> {
    success: boolean;
    data?: T;
    error?: string;
  }

  let loaded = $state(false);
  let options = $state<SandboxOptions | null>(null);
  let settingsError = $state('');
  let updating = $state(false);

  // microVM sizing drafts (bound to the number inputs; committed on change).
  let vcpusDraft = $state(2);
  let memMibDraft = $state(2048);

  // Guest-image override state ("check before save", sandbox.image.check).
  let imageOverride = $state<{ manifestUrl: string; sha256: string } | null>(null);
  let imageUrlDraft = $state('');
  let imageChecking = $state(false);
  let imageCheckResult = $state<
    | { kind: 'valid'; imageId: string; version: string; arch: string }
    | { kind: 'invalid'; error: string }
    | null
  >(null);

  // microVM guest-image download state, driven by sandbox:image:* events.
  let imageStatus = $state<
    | { kind: 'pulling' }
    | { kind: 'downloaded'; version: string }
    | { kind: 'error'; error: string }
    | null
  >(null);

  // claude-code setup-token state (not-set-up / ready / rejected).
  let tokenState = $state<'not-set-up' | 'ready' | 'rejected'>('not-set-up');
  let tokenError = $state('');
  let showTokenInput = $state(false);
  let tokenDraft = $state('');
  let tokenSaving = $state(false);

  const typeLabels: Record<SandboxType, () => string> = {
    direct: () => m.executionEnvironmentSettings_type_direct_label(),
    worktree: () => m.executionEnvironmentSettings_type_worktree_label(),
    cow: () => m.executionEnvironmentSettings_type_cow_label(),
    microvm: () => m.executionEnvironmentSettings_type_microvm_label(),
  };
  const typeDescriptions: Record<SandboxType, () => string> = {
    direct: () => m.executionEnvironmentSettings_type_direct_description(),
    worktree: () => m.executionEnvironmentSettings_type_worktree_description(),
    cow: () => m.executionEnvironmentSettings_type_cow_description(),
    microvm: () => m.executionEnvironmentSettings_type_microvm_description(),
  };

  const enabledTypes = $derived(
    (options?.options ?? []).filter((row) => row.enabled).map((row) => row.type),
  );
  const microvmRow = $derived(
    (options?.options ?? []).find((row) => row.type === 'microvm') ?? null,
  );
  const showMicrovmExtras = $derived(
    microvmRow !== null && microvmRow.enabled && microvmRow.available,
  );

  onMount(() => {
    void loadOptions();
    void loadProfiles();
    void loadTokenState();
    // Guest-image pipeline events (PROTOCOL §6.5, sandbox image family).
    const dispose = onBackendNotification((n) => {
      if (n.method !== 'events.event') return;
      const type = resolveEventType(n.params);
      if (type === 'sandbox:image:pulling') {
        imageStatus = { kind: 'pulling' };
      } else if (type === 'sandbox:image:downloaded') {
        const data = resolveEventData(n.params);
        imageStatus = {
          kind: 'downloaded',
          version: typeof data.version === 'string' ? data.version : '',
        };
      } else if (type === 'sandbox:image:error') {
        const data = resolveEventData(n.params);
        imageStatus = {
          kind: 'error',
          error: typeof data.error === 'string' ? data.error : '',
        };
      }
    });
    return dispose;
  });

  /** Unwrap `{ event: { type } }` (daemon wrapping) or flat `{ type }`. */
  function resolveEventType(params: unknown): string | undefined {
    if (!params || typeof params !== 'object') return undefined;
    const wrapped = (params as { event?: { type?: unknown } }).event;
    if (wrapped && typeof wrapped === 'object' && typeof wrapped.type === 'string') {
      return wrapped.type;
    }
    const flat = (params as { type?: unknown }).type;
    return typeof flat === 'string' ? flat : undefined;
  }

  /** Unwrap the event `data` payload from a wrapped or flat notification. */
  function resolveEventData(params: unknown): Record<string, unknown> {
    if (!params || typeof params !== 'object') return {};
    const wrapped = (params as { event?: { data?: unknown } }).event;
    const data =
      wrapped && typeof wrapped === 'object' ? wrapped.data : (params as { data?: unknown }).data;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  }

  async function loadOptions() {
    try {
      const result = await invoke<SandboxEnvelope<SandboxOptions>>(
        SANDBOX_CHANNELS.OPTIONS,
        undefined,
      );
      if (result?.success && result.data) {
        options = result.data;
        settingsError = '';
      } else {
        settingsError = m.executionEnvironmentSettings_loadError();
      }
    } catch (error) {
      settingsError = m.executionEnvironmentSettings_loadError();
      console.error('Failed to load sandbox options:', error);
    } finally {
      loaded = true;
    }
  }

  /** Read the configured profiles (microvm sizing + image override) into the drafts. */
  async function loadProfiles() {
    try {
      const result = await invoke<SandboxEnvelope<SandboxProfiles>>(
        SANDBOX_CHANNELS.PROFILES_LIST,
        undefined,
      );
      if (result?.success && result.data) {
        const microvm = result.data.profiles.find((p) => p.type === 'microvm');
        if (microvm) {
          if (typeof microvm.vcpus === 'number') vcpusDraft = microvm.vcpus;
          if (typeof microvm.memMib === 'number') memMibDraft = microvm.memMib;
          imageOverride = microvm.image ?? null;
          imageUrlDraft = microvm.image?.manifestUrl ?? '';
        }
      }
    } catch (error) {
      console.error('Failed to load sandbox profiles:', error);
    }
  }

  async function loadTokenState() {
    // Sensitive setting: reads return null (absent) or a redacted placeholder
    // (present) — never plaintext (§5.12). Any non-null value means "ready".
    const entry = await appClient.settings.get(CLAUDE_TOKEN_PATH);
    tokenState = entry !== null && entry.value != null ? 'ready' : 'not-set-up';
  }

  /** Send one profile-shaped update and re-render from the daemon's response. */
  async function applyUpdate(changes: {
    defaultType?: SandboxType;
    profiles?: Partial<
      Record<
        SandboxType,
        {
          enabled?: boolean;
          vcpus?: number;
          memMib?: number;
          image?: { manifestUrl: string; sha256: string } | null;
        }
      >
    >;
  }) {
    if (updating) return;
    updating = true;
    let updateError = '';
    try {
      const result = await invoke<SandboxEnvelope<unknown>>(
        SANDBOX_CHANNELS.PROFILES_UPDATE,
        changes,
      );
      if (!result?.success) {
        updateError = result?.error || m.executionEnvironmentSettings_saveError();
      }
    } catch (error) {
      updateError = m.executionEnvironmentSettings_saveError();
      console.error('Failed to update sandbox profiles:', error);
    } finally {
      updating = false;
      // The update result is the profiles shape (no availability); re-read the
      // full matrix so enabled/default/reason render from one source of truth.
      // A rejected update (-32602, nothing applied) keeps its error visible
      // across the refresh.
      await loadOptions();
      await loadProfiles();
      settingsError = updateError;
    }
  }

  function handleToggle(type: SandboxType, currentlyEnabled: boolean) {
    void applyUpdate({ profiles: { [type]: { enabled: !currentlyEnabled } } });
  }

  function handleDefaultChange(value: string) {
    void applyUpdate({ defaultType: value as SandboxType });
  }

  /** Commit a sizing field on change; the daemon range-validates (§5.12). */
  function handleSizingChange(field: 'vcpus' | 'memMib', raw: number) {
    if (!Number.isFinite(raw)) return;
    const value = Math.trunc(raw);
    void applyUpdate({ profiles: { microvm: { [field]: value } } });
  }

  /**
   * Check-before-save: dry-run validate the manifest URL via
   * `sandbox.image.check`; only a valid manifest is persisted (pinned to the
   * checked document's sha).
   */
  async function handleImageCheckAndSave() {
    const manifestUrl = imageUrlDraft.trim();
    if (!manifestUrl || imageChecking) return;
    imageChecking = true;
    imageCheckResult = null;
    try {
      const result = await invoke<SandboxEnvelope<SandboxImageCheck>>(
        SANDBOX_CHANNELS.IMAGE_CHECK,
        { manifestUrl },
      );
      if (result?.success && result.data) {
        if (result.data.valid) {
          const { imageId, version, arch, manifestSha256 } = result.data;
          imageCheckResult = { kind: 'valid', imageId, version, arch };
          await applyUpdate({
            profiles: { microvm: { image: { manifestUrl, sha256: manifestSha256 } } },
          });
        } else {
          imageCheckResult = { kind: 'invalid', error: result.data.error };
        }
      } else {
        imageCheckResult = {
          kind: 'invalid',
          error: result?.error || m.executionEnvironmentSettings_saveError(),
        };
      }
    } catch (error) {
      imageCheckResult = {
        kind: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      imageChecking = false;
    }
  }

  /** Clear the override (explicit `image: null`) — back to the built-in pin. */
  async function handleImageReset() {
    if (imageChecking) return;
    imageCheckResult = null;
    imageUrlDraft = '';
    await applyUpdate({ profiles: { microvm: { image: null } } });
  }

  function handleShowTokenInput() {
    tokenDraft = '';
    tokenError = '';
    showTokenInput = true;
  }

  function handleCancelTokenInput() {
    showTokenInput = false;
    tokenDraft = '';
  }

  async function handleSubmitToken() {
    const token = tokenDraft.trim();
    if (!token || tokenSaving) return;
    tokenSaving = true;
    try {
      await appClient.settings.update([{ path: CLAUDE_TOKEN_PATH, value: token }]);
      tokenState = 'ready';
      tokenError = '';
      showTokenInput = false;
      tokenDraft = '';
    } catch (error) {
      // The daemon rejected the token (validation failure on the sensitive
      // setting) — surface the token-rejected state with the daemon message.
      tokenState = 'rejected';
      tokenError = error instanceof Error ? error.message : String(error);
    } finally {
      tokenSaving = false;
    }
  }
</script>

{#if loaded}
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    {#if settingsError}
      <section class="px-6 py-2">
        <p
          class="text-xs text-danger bg-danger-background/10 border border-danger/20 rounded-md px-3 py-2"
        >
          {settingsError}
        </p>
      </section>
    {/if}

    {#each options?.options ?? [] as row (row.type)}
      <section class="px-6 py-4">
        <div class="flex justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-foreground flex items-center gap-2">
              {typeLabels[row.type]()}
              {#if row.default}
                <span
                  class="inline-flex items-center shrink-0 rounded-full bg-muted/20 px-1.5 text-ui-sm leading-4 text-subtle"
                >
                  {m.executionEnvironmentSettings_default_badge()}
                </span>
              {/if}
            </p>
            <p class="text-xs text-subtle mt-0.5" id="ee-description-{row.type}">
              {typeDescriptions[row.type]()}
            </p>
            {#if !row.available}
              <p class="text-xs text-muted-foreground mt-1" data-testid="ee-reason-{row.type}">
                {m.executionEnvironmentSettings_unavailable_prefix()}
                {row.reason}
              </p>
            {/if}
          </div>
          <!-- Direct is always enabled (the daemon rejects disabling it):
               render its toggle locked on and non-interactive. -->
          <Toggle
            pressed={row.type === 'direct' || (row.available && row.enabled)}
            onclick={row.type === 'direct' ? undefined : () => handleToggle(row.type, row.enabled)}
            variant="indicator"
            size="xs"
            class="mb-auto"
            disabled={row.type === 'direct' || !row.available || updating}
            ariaLabel={typeLabels[row.type]()}
          />
        </div>

        {#if row.type === 'microvm' && showMicrovmExtras}
          <!-- Guest-image download state (sandbox:image:* events) -->
          {#if imageStatus}
            <p class="text-xs mt-2" data-testid="ee-image-status">
              {#if imageStatus.kind === 'pulling'}
                <span class="text-subtle">{m.executionEnvironmentSettings_image_pulling()}</span>
              {:else if imageStatus.kind === 'downloaded'}
                <span class="text-subtle"
                  >{m.executionEnvironmentSettings_image_downloaded({
                    version: imageStatus.version,
                  })}</span
                >
              {:else}
                <span class="text-danger"
                  >{m.executionEnvironmentSettings_image_error({ error: imageStatus.error })}</span
                >
              {/if}
            </p>
          {/if}

          <!-- microVM sizing (sandbox.microvm.vcpus / memMib, §5.12) -->
          <div class="mt-3 space-y-1" data-testid="ee-vm-sizing">
            <p class="text-xs font-medium text-foreground">
              {m.executionEnvironmentSettings_sizing_label()}
            </p>
            <p class="text-xs text-subtle">
              {m.executionEnvironmentSettings_sizing_description()}
            </p>
            <div class="flex items-center gap-4 pt-1">
              <label class="flex items-center gap-2 text-xs text-foreground">
                {m.executionEnvironmentSettings_sizing_vcpus_label()}
                <Input
                  type="number"
                  min={MIN_VCPUS}
                  max={MAX_VCPUS}
                  step="1"
                  bind:value={vcpusDraft}
                  onchange={() => handleSizingChange('vcpus', vcpusDraft)}
                  disabled={updating}
                  aria-label={m.executionEnvironmentSettings_sizing_vcpus_label()}
                  class="w-20 text-xs"
                />
              </label>
              <label class="flex items-center gap-2 text-xs text-foreground">
                {m.executionEnvironmentSettings_sizing_memMib_label()}
                <Input
                  type="number"
                  min={MIN_MEM_MIB}
                  step="128"
                  bind:value={memMibDraft}
                  onchange={() => handleSizingChange('memMib', memMibDraft)}
                  disabled={updating}
                  aria-label={m.executionEnvironmentSettings_sizing_memMib_label()}
                  class="w-24 text-xs"
                />
              </label>
            </div>
          </div>

          <!-- Guest-image override (check-before-save via sandbox.image.check) -->
          <div class="mt-3 space-y-1" data-testid="ee-image-override">
            <p class="text-xs font-medium text-foreground">
              {m.executionEnvironmentSettings_imageOverride_label()}
            </p>
            <p class="text-xs text-subtle">
              {imageOverride
                ? m.executionEnvironmentSettings_imageOverride_custom()
                : m.executionEnvironmentSettings_imageOverride_builtIn()}
            </p>
            <div class="flex items-center gap-2 pt-1">
              <Input
                type="text"
                bind:value={imageUrlDraft}
                placeholder={/* i18n-ignore (URL format example) */ 'https://…/manifest.json'}
                aria-label={m.executionEnvironmentSettings_imageOverride_inputAriaLabel()}
                class="flex-1 text-xs"
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleImageCheckAndSave();
                }}
              />
              <Button
                variant="link"
                size="xs"
                class="shrink-0 font-medium text-xs"
                onclick={handleImageCheckAndSave}
                disabled={!imageUrlDraft.trim() || imageChecking || updating}
              >
                {imageChecking
                  ? m.executionEnvironmentSettings_imageOverride_checking()
                  : m.executionEnvironmentSettings_imageOverride_check()}
              </Button>
              {#if imageOverride}
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="shrink-0 text-xs"
                  onclick={handleImageReset}
                  disabled={imageChecking || updating}
                >
                  {m.executionEnvironmentSettings_imageOverride_reset()}
                </Button>
              {/if}
            </div>
            {#if imageCheckResult}
              <p class="text-xs" data-testid="ee-image-check-result">
                {#if imageCheckResult.kind === 'valid'}
                  <span class="text-subtle"
                    >{m.executionEnvironmentSettings_imageOverride_valid({
                      imageId: imageCheckResult.imageId,
                      version: imageCheckResult.version,
                      arch: imageCheckResult.arch,
                    })}</span
                  >
                {:else}
                  <span class="text-danger"
                    >{m.executionEnvironmentSettings_imageOverride_invalid({
                      error: imageCheckResult.error,
                    })}</span
                  >
                {/if}
              </p>
            {/if}
          </div>

          <!-- claude-code setup-token action (issue #1120) -->
          <div class="mt-3 space-y-2" data-testid="ee-claude-setup">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-xs font-medium text-foreground">
                  {m.executionEnvironmentSettings_claudeToken_label()}
                </p>
                <p class="text-xs text-subtle">
                  {#if tokenState === 'ready'}
                    {m.executionEnvironmentSettings_claudeToken_ready()}
                  {:else if tokenState === 'rejected'}
                    <span class="text-danger"
                      >{m.executionEnvironmentSettings_claudeToken_rejected()}</span
                    >
                  {:else}
                    {m.executionEnvironmentSettings_claudeToken_notSetUp()}
                  {/if}
                </p>
                {#if tokenError}
                  <p class="text-xs text-danger">{tokenError}</p>
                {/if}
              </div>
              {#if !showTokenInput}
                <Button
                  variant="link"
                  size="xs"
                  class="shrink-0 font-medium text-xs"
                  onclick={handleShowTokenInput}
                >
                  {tokenState === 'ready'
                    ? m.executionEnvironmentSettings_claudeToken_replaceAction()
                    : m.executionEnvironmentSettings_claudeToken_setupAction()}
                </Button>
              {/if}
            </div>
            {#if showTokenInput}
              <p class="text-xs text-subtle">
                {m.executionEnvironmentSettings_claudeToken_setupHint_before()}
                <!-- i18n-ignore (shell command) -->
                <code class="bg-muted px-1 rounded">claude setup-token</code>
                {m.executionEnvironmentSettings_claudeToken_setupHint_after()}
              </p>
              <div class="flex items-center gap-2">
                <Input
                  type="password"
                  bind:value={tokenDraft}
                  placeholder={/* i18n-ignore (credential format example) */ 'sk-ant-oat01-…'}
                  class="flex-1 text-xs"
                  aria-label={m.executionEnvironmentSettings_claudeToken_inputAriaLabel()}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSubmitToken();
                    if (e.key === 'Escape') handleCancelTokenInput();
                  }}
                />
                <Button
                  variant="link"
                  size="xs"
                  class="font-medium text-xs"
                  onclick={handleSubmitToken}
                  disabled={!tokenDraft.trim() || tokenSaving}
                >
                  {tokenSaving
                    ? m.executionEnvironmentSettings_claudeToken_saving()
                    : m.executionEnvironmentSettings_claudeToken_save()}
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="text-xs"
                  onclick={handleCancelTokenInput}
                >
                  {m.executionEnvironmentSettings_claudeToken_cancel()}
                </Button>
              </div>
            {/if}
          </div>
        {/if}
      </section>
    {/each}

    <!-- Default environment selector -->
    {#if options}
      <section class="px-6 py-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <label for="ee-default-select" class="text-sm font-medium text-foreground">
              {m.executionEnvironmentSettings_defaultSelector_label()}
            </label>
            <p class="text-xs text-subtle">
              {m.executionEnvironmentSettings_defaultSelector_description()}
            </p>
          </div>
          <div class="w-56">
            <Select.Root value={options.defaultType} onchange={handleDefaultChange}>
              <Select.Trigger id="ee-default-select" class="py-1.5" disabled={updating}>
                <span class="truncate">{typeLabels[options.defaultType]()}</span>
              </Select.Trigger>
              <Select.Content portal class="max-h-75 w-56">
                {#each enabledTypes as type (type)}
                  <Select.Item value={type}>
                    <span class="truncate">{typeLabels[type]()}</span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </section>
    {/if}
  </div>
{/if}
