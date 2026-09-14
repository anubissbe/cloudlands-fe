/**
 * Redact the pairing bearer token (`token=` query param, PROTOCOL §5 pairing
 * URI) and the one-time invite secret (`secret=`, `intent://invite`) in
 * free-form text destined for a log line. The deep-link entry points log the
 * URLs they receive, and both link kinds carry a credential-grade value —
 * every such log site must pass the text through this first.
 */
export function scrubToken(text: string): string {
  // i18n-ignore (log scrubbing constant, never user-facing)
  return text
    .replace(/token=[^&\s"']*/gi, 'token=REDACTED')
    .replace(/secret=[^&\s"']*/gi, 'secret=REDACTED');
}
