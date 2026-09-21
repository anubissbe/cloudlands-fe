type ForgeProvider = 'github' | 'gitlab';
export interface ForgeConnectionIdentity {
  id?: string;
  provider: ForgeProvider;
  instanceUrl: string;
}
export interface SourceControlLink {
  provider: ForgeProvider;
  connectionId: string;
  instanceUrl: string;
  owner: string;
  repo: string;
  projectUrl: string;
  kind: 'project' | 'issue' | 'pr';
  number?: number;
}
const github: ForgeConnectionIdentity = { provider: 'github', instanceUrl: 'https://github.com' };

/** Parse a URL against known server identities, never infer an authority from a suffix. */
export function parseSourceControlLink(
  input: string,
  connections: readonly ForgeConnectionIdentity[] = [],
): SourceControlLink | null {
  try {
    const scp = /^git@([^/:]+):(.+)$/.exec(input.trim());
    const value = input
      .trim()
      .replace(/^www\.github\.com\//i, 'https://github.com/')
      .replace(/^github\.com\//i, 'https://github.com/');
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : value);
    if (
      !['https:', 'http:', 'ssh:'].includes(url.protocol) ||
      url.password ||
      (url.username && url.protocol !== 'ssh:')
    )
      return null;
    if (url.hostname === 'www.github.com') url.hostname = 'github.com';
    if (url.hostname === 'github.com' && url.protocol === 'http:') url.protocol = 'https:';
    const candidates = [github, ...connections]
      .filter((connection) => {
        const base = new URL(connection.instanceUrl);
        if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) return false;
        if (url.protocol === 'ssh:') return true;
        if (url.origin !== base.origin) return false;
        const prefix = base.pathname.replace(/\/+$/, '');
        return !prefix || url.pathname.startsWith(`${prefix}/`);
      })
      .sort((a, b) => b.instanceUrl.length - a.instanceUrl.length);
    if (url.protocol === 'ssh:' && new Set(candidates.map((item) => item.instanceUrl)).size > 1)
      return null;
    const connection = candidates[0];
    if (!connection) return null;
    const base = new URL(connection.instanceUrl);
    const prefix = base.pathname.replace(/\/+$/, '');
    let path = url.pathname;
    if (url.protocol !== 'ssh:' && prefix) path = path.slice(prefix.length);
    let segments = path.replace(/^\/+|\/+$/g, '').split('/');
    let kind: SourceControlLink['kind'] = 'project';
    let number: number | undefined;
    if (connection.provider === 'github') {
      if (segments.length > 2) {
        if (segments[2] === 'pull' || segments[2] === 'issues') {
          if (!/^[1-9]\d*$/.test(segments[3] ?? '')) return null;
          kind = segments[2] === 'pull' ? 'pr' : 'issue';
          number = Number(segments[3]);
        }
        segments = segments.slice(0, 2);
      }
    } else {
      const separator = segments.indexOf('-');
      if (separator >= 0) {
        const route = segments[separator + 1];
        if (route === 'merge_requests' || route === 'issues') {
          if (!/^[1-9]\d*$/.test(segments[separator + 2] ?? '')) return null;
          kind = route === 'merge_requests' ? 'pr' : 'issue';
          number = Number(segments[separator + 2]);
        }
        segments = segments.slice(0, separator);
      }
    }
    if (
      segments.length < 2 ||
      segments.some((part) => !part || part === '.' || part === '..' || part === '-')
    )
      return null;
    const repo = segments.at(-1)!.replace(/\.git$/i, '');
    if (!repo) return null;
    const owner = segments.slice(0, -1).join('/');
    const instanceUrl = connection.instanceUrl.replace(/\/+$/, '');
    return {
      provider: connection.provider,
      connectionId: connection.id ?? instanceUrl,
      instanceUrl,
      owner,
      repo,
      projectUrl: `${instanceUrl}/${owner}/${repo}`,
      kind,
      ...(number !== undefined ? { number } : {}),
    };
  } catch {
    return null;
  }
}

/** Build a repository resource link from a resolved daemon identity. */
export function sourceControlResourceUrl(
  connection: ForgeConnectionIdentity | null | undefined,
  owner: string | null | undefined,
  repo: string | null | undefined,
  resource: 'issues' | 'pulls' | 'commit',
  revision?: string,
): string | null {
  if (!connection || !owner || !repo) return null;
  try {
    const base = new URL(connection.instanceUrl);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) return null;
    const segments = [...owner.split('/'), repo];
    if (segments.some((part) => !part || part === '.' || part === '..')) return null;
    const project = `${connection.instanceUrl.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}`;
    const route =
      connection.provider === 'gitlab'
        ? `-/${resource === 'pulls' ? 'merge_requests' : resource}`
        : resource;
    if (resource === 'commit')
      return revision ? `${project}/${route}/${encodeURIComponent(revision)}` : null;
    return `${project}/${route}`;
  } catch {
    return null;
  }
}

/** Preserve a real forge resource URL; reconstruct only legacy GitHub mentions. */
export function contextMentionUrl(rawUrl: string, identifier: string, isPull: boolean): string {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return rawUrl;
    if (/^\/[^/]+\/[^/]+\/(pull|issues)\/[1-9]\d*(?:[/?#]|$)/.test(url.pathname)) return rawUrl;
  } catch {
    return rawUrl;
  }
  const match = /^([^/#]+)\/([^/#]+)#([1-9]\d*)$/.exec(identifier);
  return match
    ? `https://github.com/${match[1]}/${match[2]}/${isPull ? 'pull' : 'issues'}/${match[3]}`
    : rawUrl;
}
