<script lang="ts">
  /**
   * Choose a source control provider and connect it during onboarding.
   * GitHub uses the daemon device flow; GitLab reuses the connection form
   * from Settings. Each connection keeps its own authentication state. Connection is optional.
   */
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import {
    initializeGitHubAuth,
    startGitHubAuth,
    cancelGitHubAuth,
    checkGitHubAuthStatus,
  } from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
    selectSourceControlIsAuthenticated,
    selectSourceControlSettings,
    selectGitHubAuthIsAuthenticating,
    selectGitHubAuthDeviceFlow,
    selectGitHubAuthError,
    selectGitHubAuthRequiresDaemonAuth,
  } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import SourceControlSettings from '$lib/components/settings/SourceControlSettings.svelte';
  import SourceControlIcon from '$features/source-control/SourceControlIcon.svelte';
  import {
    selectSourceControlConnections,
    selectSourceControlBusy,
    selectSourceControlUser,
  } from '$store/renderer/slices/source-control/source-control-selectors';
  import { selectSourceControlConnection } from '$store/renderer/slices/source-control/source-control-slice';
  import type { SourceControlProvider } from '$features/source-control/types';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';

  interface Props {
    /** Advance to the next onboarding step (Continue when connected). */
    onContinue: () => void;
    /** Advance without connecting — GitHub stays optional. */
    onSkip: () => void;
    onAdvanceAllowedChange?: (allowed: boolean) => void;
  }

  let { onContinue, onSkip, onAdvanceAllowedChange }: Props = $props();

  const authenticated$ = selectSourceControlIsAuthenticated();
  const connections$ = selectSourceControlConnections();
  const registryBusy$ = selectSourceControlBusy();
  const settings$ = selectSourceControlSettings();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  let providerDraft = $state<SourceControlProvider>();
  let gitlabConnectionReady = $state(false);
  const provider = $derived(providerDraft ?? $settings$.provider);
  const isAuthenticated = $derived(
    $authenticated$ &&
      provider === $settings$.provider &&
      (provider !== 'gitlab' || gitlabConnectionReady),
  );

  const canAdvance = $derived(
    (provider === 'github' || !$registryBusy$) &&
      (!($authenticated$ && provider === $settings$.provider) || isAuthenticated),
  );
  $effect(() => onAdvanceAllowedChange?.(canAdvance));

  function chooseProvider(next: SourceControlProvider) {
    if (next === provider) return;
    if ($isAuthenticating$ && $deviceFlow$) appStore.dispatch(cancelGitHubAuth());
    providerDraft = next;
    gitlabConnectionReady = false;
    const target =
      $connections$.find((item) => item.provider === next && item.isConfigured) ??
      $connections$.find((item) => item.provider === next);
    if (target) appStore.dispatch(selectSourceControlConnection(target.id));
  }
  const deviceFlow$ = selectGitHubAuthDeviceFlow();
  const user$ = selectSourceControlUser();
  const error$ = selectGitHubAuthError();
  const requiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  onMount(() => {
    // Hydrate auth state so an already-resolved token (env, gh CLI, or a
    // stored device-flow token) renders as connected instead of forcing a
    // reconnect. Also resumes a still-pending device flow (§5.27).
    appStore.dispatch(initializeGitHubAuth());

    // Check auth status immediately when window gains focus so the UI
    // updates snappily when the user returns from the browser.
    const handleFocus = () => {
      const state = appStore.state;
      const isAuthenticating = selectGitHubAuthIsAuthenticating.select(state);
      const deviceFlow = selectGitHubAuthDeviceFlow.select(state);
      if (isAuthenticating && deviceFlow) {
        appStore.dispatch(checkGitHubAuthStatus());
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  });

  function handleConnect() {
    appStore.dispatch(startGitHubAuth());
  }

  function handleCancel() {
    appStore.dispatch(cancelGitHubAuth());
  }

  function handleSkip() {
    // Skipping abandons a still-pending device flow — cancel it so it doesn't
    // keep polling in the background and resurface in Settings.
    if (selectGitHubAuthIsAuthenticating.select(appStore.state)) {
      appStore.dispatch(cancelGitHubAuth());
    }
    onSkip();
  }
</script>

<div class="space-y-6">
  <div class="flex gap-2" role="group" aria-label={m.settings_sourceControl_provider_label()}>
    {#each ['github', 'gitlab'] as option}
      {@const choice = option as SourceControlProvider}
      <Button
        variant={provider === choice ? 'secondary' : 'outline'}
        aria-pressed={provider === choice}
        onclick={() => chooseProvider(choice)}
        disabled={$registryBusy$ ||
          ($isAuthenticating$ && !$deviceFlow$) ||
          (choice === 'gitlab' && !$settings$.gitlabSupported)}
      >
        <SourceControlIcon provider={choice} />
        <!-- i18n-ignore (brand names) -->
        {choice === 'github' ? 'GitHub' : 'GitLab'}
      </Button>
    {/each}
  </div>
  {#if provider === 'gitlab'}
    <SourceControlSettings
      initialProvider="gitlab"
      showProviderPicker={false}
      embedded
      onConnectionReadyChange={(ready) => (gitlabConnectionReady = ready)}
    />
  {:else}
    {#if isAuthenticated}
      <div class="flex items-center gap-3 text-base" data-testid="github-step-connected">
        <SourceControlIcon {provider} class="text-foreground" />
        <span class="flex items-center gap-2">
          <Fa icon={faCheck} class="text-green-500" />
          {#if $user$}
            {m.onboarding_githubStep_connectedAs_label({ username: `@${$user$.login}` })}
          {:else}
            {m.onboarding_githubStep_connected_label()}
          {/if}
        </span>
      </div>
    {:else if $isAuthenticating$ && $deviceFlow$}
      <div class="max-w-sm space-y-3" data-testid="github-step-device-flow">
        <GitHubDeviceCodeCard
          userCode={$deviceFlow$.userCode}
          verificationUri={$deviceFlow$.verificationUri}
        />
        <div class="flex items-center gap-2 text-subtle text-sm">
          <IntentMarkLoader size={16} class="shrink-0" />
          <span>{m.onboarding_githubStep_waitingForAuthorization_label()}</span>
          <Button
            variant="ghost"
            type="button"
            class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors ml-2"
            onclick={handleCancel}
          >
            {m.onboarding_githubStep_cancel_label()}
          </Button>
        </div>
      </div>
    {:else if $isAuthenticating$}
      <div class="flex items-center gap-2 text-subtle text-sm">
        <IntentMarkLoader size={16} class="shrink-0" />
        <span>{m.onboarding_githubStep_startingAuthentication_label()}</span>
      </div>
    {:else if $requiresDaemonAuth$}
      <p class="text-sm text-subtle">{m.onboarding_githubStep_requiresDaemonAuth_label()}</p>
    {:else}
      <Button
        class="group/button"
        size="xl"
        variant="primary"
        onclick={handleConnect}
        disabled={$settings$.provider !== 'github'}
      >
        <SourceControlIcon {provider} />
        {m.onboarding_githubStep_connectGithub_label()}
      </Button>
    {/if}

    {#if $error$}
      <p class="text-sm text-danger">{$error$}</p>
    {/if}
  {/if}

  <div class="flex flex-col items-start gap-2 mt-9">
    {#if $authenticated$ && provider === $settings$.provider}
      <Button
        class="group/button"
        size="xl"
        variant="primary"
        onclick={onContinue}
        disabled={!isAuthenticated}
      >
        {m.onboarding_githubStep_continue_label()}
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
    {:else}
      <Button
        class="group/button"
        size="xl"
        variant="outline"
        onclick={handleSkip}
        disabled={!canAdvance}
      >
        {m.onboarding_githubStep_skipForNow_label()}
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
      <p class="text-xs text-muted-foreground">
        {m.onboarding_sourceControl_connectLater_description()}
      </p>
    {/if}
  </div>
</div>
