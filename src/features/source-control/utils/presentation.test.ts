import { describe, expect, it } from 'vitest';
import { sourceControlInstanceLabel } from './presentation';

describe('sourceControlInstanceLabel', () => {
  it('shows the server and installation path without credentials or query values', () => {
    expect(
      sourceControlInstanceLabel(
        'https://user:password@git.example:8443/gitlab/?token=secret#fragment',
      ),
    ).toBe('git.example:8443/gitlab');
  });
  it('omits a trailing slash and hides malformed URLs', () => {
    expect(sourceControlInstanceLabel('https://git.euraika.net/')).toBe('git.euraika.net');
    expect(sourceControlInstanceLabel('invalid private text')).toBe('');
  });
});
