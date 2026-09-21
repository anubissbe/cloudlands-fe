/** Match a pending forge link to a recent checkout without losing its authority. */
import {
  parseSourceControlLink,
  type ForgeConnectionIdentity,
} from '$shared/utils/source-control-url';

export interface GitHubPrefillRepoCandidate {
  path: string;
  type: 'local' | 'github';
  name?: string;
  owner?: string;
  githubUrl?: string;
}
export type GitHubPrefillRepoSelection =
  | { kind: 'local'; path: string }
  | { kind: 'github'; githubUrl: string; path: string }
  | { kind: 'keep' };
export interface MatchGitHubPrefillRepoInput {
  owner: string;
  repo: string;
  url?: string;
  projectUrl?: string;
  provider?: 'github' | 'gitlab';
  instanceUrl?: string;
  connectionId?: string;
  connections?: readonly ForgeConnectionIdentity[];
  candidates: GitHubPrefillRepoCandidate[];
  probeRemote: (
    repoPath: string,
  ) => Promise<{ owner: string; repo: string; remoteUrl?: string; repoUrl?: string } | null>;
}
const MAX_REMOTE_PROBES = 10;
const cleanName = (name: string) => name.replace(/\.git$/i, '');

export async function matchGitHubPrefillRepo(
  input: MatchGitHubPrefillRepoInput,
): Promise<GitHubPrefillRepoSelection> {
  const { owner, repo, candidates, probeRemote } = input;
  const identities = [...(input.connections ?? [])];
  if (input.provider && input.instanceUrl)
    identities.push({
      provider: input.provider,
      instanceUrl: input.instanceUrl,
      id: input.connectionId,
    });
  const explicit = input.projectUrl ?? input.url;
  const target = parseSourceControlLink(
    explicit ?? `${input.instanceUrl ?? 'https://github.com'}/${owner}/${cleanName(repo)}`,
    identities,
  );
  if (!target) return { kind: 'keep' };
  const matches = (candidate: {
    owner: string;
    repo: string;
    projectUrl?: string;
    connectionId?: string;
  }) =>
    (target.provider === 'github'
      ? candidate.owner.toLowerCase() === target.owner.toLowerCase() &&
        cleanName(candidate.repo).toLowerCase() === target.repo.toLowerCase()
      : candidate.owner === target.owner && cleanName(candidate.repo) === target.repo) &&
    (candidate.connectionId === target.connectionId || (!explicit && !candidate.connectionId));
  try {
    const unresolved: GitHubPrefillRepoCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.path || seen.has(candidate.path)) continue;
      seen.add(candidate.path);
      if (candidate.githubUrl) {
        const parsed = parseSourceControlLink(candidate.githubUrl, identities);
        if (parsed && matches(parsed))
          return candidate.type === 'local'
            ? { kind: 'local', path: candidate.path }
            : { kind: 'github', githubUrl: candidate.githubUrl, path: candidate.path };
        continue;
      }
      // Older callers lacked a URL. Preserve that GH-only contract; an actual
      // link prefill always carries a URL and must prove a local candidate's host.
      if (!explicit && candidate.owner && candidate.name) {
        if (matches({ owner: candidate.owner, repo: candidate.name }))
          return candidate.type === 'local'
            ? { kind: 'local', path: candidate.path }
            : { kind: 'github', githubUrl: target.projectUrl, path: candidate.path };
        continue;
      }
      if (candidate.type === 'local') unresolved.push(candidate);
    }
    for (const candidate of unresolved.slice(0, MAX_REMOTE_PROBES)) {
      const detected = await probeRemote(candidate.path);
      if (!detected) continue;
      const url = detected.repoUrl ?? detected.remoteUrl;
      const parsed = url ? parseSourceControlLink(url, identities) : !explicit ? detected : null;
      if (parsed && matches(parsed)) return { kind: 'local', path: candidate.path };
    }
    return { kind: 'github', githubUrl: target.projectUrl, path: `${target.owner}/${target.repo}` };
  } catch {
    return { kind: 'keep' };
  }
}
