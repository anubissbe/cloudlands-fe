// @vitest-environment node
// @verify-changed-triggers: .github/workflows/intent-pr.yml
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/intent-pr.yml', 'utf8');
const script = workflow.match(/          script: \|\n((?:            .*\n|\n)+)/)![1];

async function route(owner: string, runners: unknown[] | Error = []) {
  const outputs: Record<string, string> = {};
  let probes = 0;
  await runInNewContext(`(async () => { ${script} })()`, {
    context: { repo: { owner, repo: 'cloudlands-fe' }, runId: 1 },
    process: { env: {} },
    core: {
      info() {},
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
    },
    github: {
      paginate: async () => {
        probes++;
        if (runners instanceof Error) throw runners;
        return runners;
      },
      rest: {
        actions: {
          listSelfHostedRunnersForOrg() {},
          listSelfHostedRunnersForRepo() {},
          listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [] } }),
        },
      },
    },
  });
  return { outputs, probes };
}

it('uses accessible hosted runners for forks without probing Intent infrastructure', async () => {
  const { outputs, probes } = await route('anubissbe');
  expect(JSON.parse(outputs.linux_labels)).toEqual(['ubuntu-latest']);
  expect(outputs.linux_burst).toBe('true');
  expect(probes).toBe(0);
});

it('keeps the upstream larger runner fallback when probing is forbidden', async () => {
  const { outputs } = await route('intent-hq', new Error('permission denied'));
  expect(JSON.parse(outputs.linux_labels)).toEqual(['gh-linux-8x']);
  expect(outputs.linux_burst).toBe('true');
});

it('keeps upstream routing to a healthy self-hosted fleet', async () => {
  const { outputs } = await route('intent-hq', [
    {
      status: 'online',
      labels: ['self-hosted', 'Linux', 'X64'].map((name) => ({ name })),
    },
  ]);
  expect(JSON.parse(outputs.linux_labels)).toEqual(['self-hosted', 'Linux', 'X64']);
  expect(outputs.linux_burst).toBe('false');
});
