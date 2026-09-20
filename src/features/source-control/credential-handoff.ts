import type { SourceControlConfiguration } from './types';

// One-shot handoff outside Redux: neither action logging nor state snapshots receive a PAT.
// Weak keys also discard unused submissions when their action is garbage-collected.
const tokens = new WeakMap<SourceControlConfiguration, string>();

export function prepareSourceControlConfiguration(
  config: SourceControlConfiguration,
): SourceControlConfiguration {
  if (config.provider === 'github') return config;
  const { token, ...safe } = config;
  if (token) tokens.set(safe, token);
  return safe;
}

export function consumeSourceControlConfiguration(
  config: SourceControlConfiguration,
): SourceControlConfiguration {
  const token = tokens.get(config);
  tokens.delete(config);
  return config.provider === 'gitlab' && token ? { ...config, token } : config;
}
