import { describe, expect, it } from 'vitest';
import {
  prepareSourceControlConfiguration,
  consumeSourceControlConfiguration,
} from './credential-handoff';

describe('source-control credential handoff', () => {
  it('keeps credentials out of serializable actions and allows one consumption only', () => {
    const safe = prepareSourceControlConfiguration({
      provider: 'gitlab',
      instanceUrl: 'https://git.euraika.net',
      tokenSource: 'explicit',
      token: 'synthetic-secret',
    });
    expect(safe).toEqual({
      provider: 'gitlab',
      instanceUrl: 'https://git.euraika.net',
      tokenSource: 'explicit',
    });
    expect(consumeSourceControlConfiguration(safe)).toMatchObject({ token: 'synthetic-secret' });
    expect(consumeSourceControlConfiguration(safe)).not.toHaveProperty('token');
    expect(consumeSourceControlConfiguration(JSON.parse(JSON.stringify(safe)))).not.toHaveProperty(
      'token',
    );
  });
});
