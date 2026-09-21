import { backendRequest } from '$lib/client/live/backend-transport';
import type {
  SourceControlConfiguration,
  SourceControlConnection,
  ResolvedSourceControlRepository,
} from '../types';

export async function listSourceControlConnections(): Promise<SourceControlConnection[]> {
  const { connections } = await backendRequest<{ connections: SourceControlConnection[] }>(
    'sourceControl.connections.list',
  );
  return connections;
}

export async function configureSourceControl(
  config: Extract<SourceControlConfiguration, { provider: 'gitlab' }>,
): Promise<SourceControlConnection> {
  const { connection } = await backendRequest<{ connection: SourceControlConnection }>(
    'sourceControl.connections.configure',
    {
      ...config,
      instanceUrl: config.instanceUrl.trim(),
      ...(config.token ? { token: config.token.trim() } : {}),
    },
  );
  return connection;
}

export async function disconnectSourceControl(
  connectionId: string,
): Promise<SourceControlConnection> {
  const { connection } = await backendRequest<{ connection: SourceControlConnection }>(
    'sourceControl.connections.disconnect',
    { connectionId },
  );
  return connection;
}

export async function sourceControlAuthStatus(
  connectionId: string,
): Promise<SourceControlConnection> {
  const { connection } = await backendRequest<{ connection: SourceControlConnection }>(
    'sourceControl.authStatus',
    { connectionId },
  );
  return connection;
}

export function resolveSourceControlRepository(
  context: { workspaceId: string } | { repoUrl: string },
): Promise<ResolvedSourceControlRepository> {
  return backendRequest('sourceControl.resolve', context);
}
