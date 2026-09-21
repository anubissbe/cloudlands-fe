import type { SourceControlSettings } from '../types';
import { parseSourceControlLink } from '$shared/utils/source-control-url';

type ForgeSettings = Pick<SourceControlSettings, 'provider' | 'instanceUrl'> &
  Pick<SourceControlSettings, 'connections'>;
const githubSettings: ForgeSettings = { provider: 'github', instanceUrl: 'https://github.com' };

export function repositoryBaseUrl(settings: ForgeSettings = githubSettings): string {
  return settings.instanceUrl.replace(/\/+$/, '');
}
function identities(settings: ForgeSettings) {
  return (
    settings.connections ?? [
      { provider: settings.provider, instanceUrl: repositoryBaseUrl(settings) },
    ]
  );
}
export function parseForgeRemote(
  remote: string,
  settings: ForgeSettings = githubSettings,
): { owner: string; repo: string } | null {
  const parsed = parseSourceControlLink(remote, identities(settings));
  if (!parsed || parsed.kind !== 'project') return null;
  // Git remotes must name the repository itself, not a web subpage.
  const trimmed = remote
    .trim()
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '');
  if (/^https?:/i.test(trimmed) && trimmed !== parsed.projectUrl) return null;
  return { owner: parsed.owner, repo: parsed.repo };
}
export function parseRepositoryInput(
  input: string,
  settings: ForgeSettings = githubSettings,
): { owner: string; repo: string } | null {
  const parsed = repositoryInputReference(input, settings);
  return parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
}
export function repositoryInputReference(input: string, settings: ForgeSettings = githubSettings) {
  let value = input.trim();
  if (!value) return null;
  const base = new URL(repositoryBaseUrl(settings));
  if (value.startsWith(`${base.host}${base.pathname.replace(/\/$/, '')}/`))
    value = `${base.protocol}//${value}`;
  if (!/^(https?:\/\/|ssh:\/\/|git@|(?:www\.)?github\.com\/)/i.test(value)) {
    if (
      !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\/?$/.test(value) ||
      value.split('/').some((part) => part === '.' || part === '..' || part === '-')
    )
      return null;
    value = `${repositoryBaseUrl(settings)}/${value}`;
  }
  return parseSourceControlLink(value, identities(settings));
}
export function normalizeRepositoryInput(
  input: string,
  settings: ForgeSettings = githubSettings,
): string {
  const parsed = repositoryInputReference(input, settings);
  return parsed ? `${parsed.owner}/${parsed.repo}` : input.trim();
}
export function repositoryInputUrl(
  input: string,
  settings: ForgeSettings = githubSettings,
): string {
  const parsed = repositoryInputReference(input, settings);
  if (!parsed) return '';
  if (/^(ssh:\/\/|git@)/i.test(input.trim())) return input.trim();
  if (parsed.kind !== 'project')
    return `${parsed.projectUrl}/${parsed.provider === 'gitlab' ? '-/' : ''}${parsed.kind === 'issue' ? 'issues' : parsed.provider === 'gitlab' ? 'merge_requests' : 'pull'}/${parsed.number}`;
  return parsed.projectUrl;
}
export function repositoryUrl(
  repo: { owner: string; name: string; htmlUrl?: string },
  settings: ForgeSettings = githubSettings,
): string {
  return repo.htmlUrl || repositoryInputUrl(`${repo.owner}/${repo.name}`, settings);
}
