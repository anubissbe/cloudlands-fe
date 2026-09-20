<script lang="ts">
  import { onDestroy } from 'svelte';
  import OnboardingGitHubStep from '../steps/OnboardingGitHubStep.svelte';
  import ProjectPickerMessage, {
    type ProjectSelection,
  } from '../messages/ProjectPickerMessage.svelte';
  import {
    installGitlabOnboardingFixture,
    type OnboardingRpcCall,
  } from './gitlab-onboarding.fixture';

  import { selectSourceControlConnections } from '$store/renderer/slices/source-control/source-control-selectors';

  const connections$ = selectSourceControlConnections();
  let stage = $state<'connection' | 'project'>('connection');
  let calls = $state<OnboardingRpcCall[]>([]);
  let selection = $state<ProjectSelection | null>(null);
  let advanced = $state(false);
  const cleanup = installGitlabOnboardingFixture((next) => {
    calls = next;
  });
  onDestroy(cleanup);
</script>

<div class="p-6 max-w-3xl">
  {#if stage === 'connection'}
    <OnboardingGitHubStep
      onContinue={() => {
        stage = 'project';
      }}
      onSkip={() => {
        stage = 'project';
      }}
    />
  {:else}
    <ProjectPickerMessage
      onProjectChange={(next) => {
        selection = next;
      }}
      onSelectAndAdvance={() => {
        advanced = true;
      }}
    />
  {/if}
  <output class="sr-only" data-testid="onboarding-connections"
    >{JSON.stringify($connections$)}</output
  >
  <output class="sr-only" data-testid="onboarding-rpc-calls">{JSON.stringify(calls)}</output>
  <output class="sr-only" data-testid="onboarding-selection"
    >{JSON.stringify({ selection, advanced })}</output
  >
</div>
