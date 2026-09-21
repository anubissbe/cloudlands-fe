/** Human-readable instance identity; never includes credentials or URL query values. */
export function sourceControlInstanceLabel(instanceUrl: string): string {
  try {
    const url = new URL(instanceUrl);
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}
