<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch */
  /**
   * ExecutionEnvironmentPicker — creation-time execution-environment selector
   * (PROTOCOL §5.5b / §5.1 v3.3).
   *
   * Daemon-backed catalog read (same direct-call pattern as
   * ExecutionEnvironmentSettings): `sandbox.options` is a stateless
   * capability matrix, not Redux domain state.
   *
   * Offers only the types that are enabled in settings AND available on the
   * host (`sandbox.options`), preselecting the profile default. Renders
   * nothing when the surface is unavailable (older daemon / transport
   * failure) so the legacy skip-isolation-only flow is untouched — the picker
   * is additive, never a silently wrong gate.
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { SandboxOptions, SandboxType } from '$shared/schemas';
  import { Select } from '$lib/components/ui/select';
  import {
    environmentDescription,
    environmentLabel,
    loadExecutionEnvironmentOptions,
    pickableEnvironments,
    preselectedEnvironment,
  } from './execution-environment';

  interface Props {
    /** Currently selected type; `null` until options load (or when none are pickable). */
    value?: SandboxType | null;
    /** Fired when the user picks a type (also on the initial preselection). */
    onchange?: (value: SandboxType) => void;
  }

  let { value = $bindable(null), onchange }: Props = $props();

  let options = $state<SandboxOptions | null>(null);
  const pickable = $derived(options ? pickableEnvironments(options) : []);

  onMount(() => {
    void (async () => {
      const loaded = await loadExecutionEnvironmentOptions();
      if (!loaded) return;
      options = loaded;
      if (value === null || !pickableEnvironments(loaded).includes(value)) {
        const preselect = preselectedEnvironment(loaded);
        if (preselect !== null) {
          value = preselect;
          onchange?.(preselect);
        }
      }
    })();
  });

  // Select binds a plain string; bridge to the typed value.
  let selectValue = $state('');
  $effect(() => {
    selectValue = value ?? '';
  });
  function handleSelectChange(next: string) {
    if (!next || next === value) return;
    const typed = pickable.find((t) => t === next);
    if (!typed) return;
    value = typed;
    onchange?.(typed);
  }
</script>

{#if options && pickable.length > 0 && value}
  <!-- Sentence fragment: "using <env> isolation" — completes the
       "Set up dev environment with <script> script" sentence. The fragments
       live here so they vanish with the picker (older daemon → plain
       legacy sentence, no dangling "using … isolation"). -->
  <div class="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
    {#if m.workspace_compactInitializer_usingIsolation_before()}
      <span>{m.workspace_compactInitializer_usingIsolation_before()}</span>
    {/if}
    <Select.Root bind:value={selectValue} onchange={handleSelectChange}>
      <Select.Trigger
        variant="ghost"
        class="w-auto bg-background! px-2! py-0.5! rounded-none font-medium"
        aria-label={m.workspaceInitializer_executionEnvironment_ariaLabel()}
      >
        {environmentLabel(value)}
      </Select.Trigger>
      <Select.Content wrapperClass="py-0!" class="max-w-90 min-w-65" portal>
        {#each pickable as type (type)}
          <Select.Item class="cursor-pointer" value={type}>
            <div class="flex-1 min-w-0">
              <div class="text-sm">
                {environmentLabel(type)}
                {#if options.defaultType === type}
                  <span class="text-xs text-subtle">
                    · {m.executionEnvironmentSettings_default_badge()}
                  </span>
                {/if}
              </div>
              <div class="text-xs text-subtle">{environmentDescription(type)}</div>
            </div>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
    {#if m.workspace_compactInitializer_usingIsolation_after()}
      <p class="text-sm text-subtle">{m.workspace_compactInitializer_usingIsolation_after()}</p>
    {/if}
  </div>
{/if}
