<script lang="ts">
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
  import SourceControlIcon from '$features/source-control/SourceControlIcon.svelte';
  import { sourceControlInstanceLabel } from '$features/source-control/utils/presentation';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectSourceControlBusy,
    selectSourceControlError,
    selectSourceControlConnections,
  } from '$store/renderer/slices/source-control/source-control-selectors';
  import {
    configureSourceControlRequested,
    disconnectSourceControlRequested,
  } from '$store/renderer/slices/source-control/source-control-slice';
  import type { SourceControlConnection, GitLabTokenSource } from '$features/source-control/types';

  let {
    connection,
    embedded = false,
    onConnectionReadyChange,
  }: {
    connection?: SourceControlConnection;
    embedded?: boolean;
    onConnectionReadyChange?: (ready: boolean) => void;
  } = $props();
  const connections$ = selectSourceControlConnections();
  const busy$ = selectSourceControlBusy();
  const error$ = selectSourceControlError();
  let instanceDraft = $state<string>();
  let sourceDraft = $state<GitLabTokenSource>();
  let token = $state('');
  let submittedInstance = $state<string>();
  const instanceUrl = $derived(instanceDraft ?? connection?.instanceUrl ?? 'https://gitlab.com');
  const tokenSource = $derived(sourceDraft ?? connection?.tokenSource ?? 'explicit');
  const canonicalInstanceUrl = $derived.by(() => {
    try {
      return new URL(instanceUrl.trim()).toString().replace(/\/+$/, '');
    } catch {
      return instanceUrl.trim();
    }
  });
  const effectiveConnection = $derived(
    connection ??
      (submittedInstance === canonicalInstanceUrl
        ? $connections$.find(
            (item) => item.provider === 'gitlab' && item.instanceUrl === submittedInstance,
          )
        : undefined),
  );
  const instanceLabel = $derived(sourceControlInstanceLabel(instanceUrl));
  const matchesVerifiedConnection = $derived(
    !token &&
      canonicalInstanceUrl === effectiveConnection?.instanceUrl &&
      tokenSource === effectiveConnection?.tokenSource,
  );
  const connected = $derived(
    effectiveConnection?.enabled === true &&
      effectiveConnection.isConfigured &&
      matchesVerifiedConnection &&
      !$error$,
  );
  $effect(() => onConnectionReadyChange?.(connected && !$busy$));
  const authenticationDescription = $derived(
    tokenSource === 'glab-cli'
      ? m.settings_sourceControl_glab_description()
      : tokenSource === 'env'
        ? m.settings_sourceControl_environment_description()
        : tokenSource === 'auto'
          ? m.settings_sourceControl_auto_description()
          : undefined,
  );

  function save() {
    submittedInstance = canonicalInstanceUrl;
    appStore.dispatch(
      configureSourceControlRequested({
        provider: 'gitlab',
        instanceUrl,
        tokenSource,
        ...(token ? { token } : {}),
      }),
    );
    token = '';
  }

  const schema = defineSettings({
    sections: [
      {
        id: 'source-control',
        get title() {
          return m.settings_sourceControl_title();
        },
        get description() {
          return m.settings_sourceControl_description();
        },
        entries: [
          {
            kind: 'custom',
            id: 'source-control-identity',
            layout: 'full-width',
            get label() {
              return m.settings_sourceControl_connection_label();
            },
          },
          {
            kind: 'input',
            id: 'gitlab-instance',
            inputType: 'url',
            get label() {
              return m.settings_sourceControl_instance_label();
            },
            get description() {
              return m.settings_sourceControl_instance_description();
            },
            placeholder: 'https://gitlab.com', // i18n-ignore (URL)
            get: () => instanceUrl,
            set: (value) => {
              instanceDraft = value;
              token = '';
              submittedInstance = undefined;
            },
            disabled: () => $busy$,
          },
          {
            kind: 'select',
            id: 'gitlab-token-source',
            get label() {
              return m.settings_sourceControl_tokenSource_label();
            },
            get description() {
              return authenticationDescription;
            },
            get: () => tokenSource,
            set: (value) => {
              sourceDraft = value as GitLabTokenSource;
              token = '';
              submittedInstance = undefined;
            },
            disabled: () => $busy$,
            get options() {
              return [
                { value: 'explicit', label: m.settings_sourceControl_token_label() },
                { value: 'glab-cli', label: m.settings_sourceControl_glab_label() },
                { value: 'env', label: m.settings_sourceControl_environment_label() },
                { value: 'auto', label: m.settings_sourceControl_auto_label() },
              ];
            },
          },
          {
            kind: 'input',
            id: 'gitlab-token',
            inputType: 'password',
            get label() {
              return m.settings_sourceControl_token_label();
            },
            get description() {
              return m.settings_sourceControl_token_description();
            },
            get: () => token,
            set: (value) => {
              token = value;
            },
            when: () => tokenSource === 'explicit' || tokenSource === 'auto',
            disabled: () => $busy$,
          },
          {
            kind: 'action',
            id: 'source-control-save',
            get label() {
              return m.settings_sourceControl_connection_label();
            },
            get actionLabel() {
              return embedded
                ? m.settings_sourceControl_connectProvider_label({ provider: 'GitLab' })
                : m.settings_sourceControl_saveTest_label();
            },
            action: save,
            disabled: () => $busy$ || !instanceUrl.trim(),
            busy: () => $busy$,
            error: () => $error$ ?? undefined,
          },
          {
            kind: 'action',
            id: 'gitlab-disconnect',
            get label() {
              return m.settings_connections_disconnect();
            },
            get description() {
              return m.settings_sourceControl_disconnect_description();
            },
            get actionLabel() {
              return m.settings_connections_disconnect();
            },
            action: () => {
              if (effectiveConnection)
                appStore.dispatch(disconnectSourceControlRequested(effectiveConnection.id));
              token = '';
              submittedInstance = undefined;
            },
            when: () =>
              !embedded &&
              effectiveConnection?.enabled === true &&
              effectiveConnection.isConfigured,
            disabled: () => $busy$,
          },
        ],
      },
    ],
  });
</script>

{#snippet connectionIdentity()}
  <div class="flex min-w-0 flex-wrap items-center gap-3" data-testid="source-control-identity">
    <SourceControlIcon provider="gitlab" size={28} class="shrink-0 text-foreground" />
    <div class="min-w-0 flex-1 space-y-1">
      <!-- i18n-ignore (brand name) -->
      <p class="type-body font-medium text-foreground">GitLab</p>
      <p class="type-caption break-all text-muted-foreground">{instanceLabel}</p>
    </div>
    <div class="type-caption flex max-w-full items-center gap-1.5" role="status" aria-live="polite">
      {#if $busy$}
        <IntentMarkLoader size={14} />
        <span class="text-muted-foreground">{m.settings_sourceControl_checking_label()}</span>
      {:else if connected}
        <CheckCircleIcon size={16} weight="fill" class="shrink-0 text-success" aria-hidden="true" />
        <span class="break-all text-foreground">
          {effectiveConnection?.user?.login
            ? m.settings_sourceControl_connected_label({ user: effectiveConnection!.user!.login })
            : m.settings_connections_connected()}
        </span>
      {:else}
        <span class="text-muted-foreground">
          {matchesVerifiedConnection
            ? m.settings_sourceControl_notConnected_label()
            : m.settings_sourceControl_unsaved_label()}
        </span>
      {/if}
    </div>
  </div>
{/snippet}

<div class={embedded ? '' : 'py-4'}>
  <SettingsForm
    {schema}
    compact={embedded}
    embedded
    custom={defineSettingsCustomControls({
      'source-control-identity': connectionIdentity,
    })}
  />
</div>
