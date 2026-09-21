export type SourceControlProvider = 'github' | 'gitlab';
export type GitLabTokenSource = 'auto' | 'explicit' | 'env' | 'glab-cli';

/** Connection identity and authentication are owned by the daemon registry. */
export interface SourceControlConnection {
  id: string;
  provider: SourceControlProvider;
  instanceUrl: string;
  tokenSource: GitLabTokenSource;
  enabled: boolean;
  isConfigured: boolean;
  user: { login: string; avatarUrl: string; htmlUrl: string } | null;
}

/** The connection selected for browsing; this does not change daemon routing. */
export interface SourceControlSettings {
  provider: SourceControlProvider;
  gitlabSupported: boolean;
  instanceUrl: string;
  tokenSource: GitLabTokenSource;
  connectionId?: string;
  connections?: SourceControlConnection[];
}

export type SourceControlConfiguration =
  | { provider: 'github' }
  | { provider: 'gitlab'; instanceUrl: string; tokenSource: GitLabTokenSource; token?: string };

export interface SourceControlRepositoryContext {
  connectionId?: string;
  repoUrl?: string;
}

export interface ResolvedSourceControlRepository {
  connectionId: string;
  provider: SourceControlProvider;
  instanceUrl: string;
  repo: { owner: string; name: string; htmlUrl: string };
  resource?: { kind: 'pr' | 'issue'; number: number } | null;
}
