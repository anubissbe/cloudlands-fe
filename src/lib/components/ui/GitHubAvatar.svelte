<script lang="ts">
  /**
   * Forge owner avatar with a load-failure fallback.
   *
   * The failure state is cleared whenever the identity changes, so switching the
   * same node to another login (or back again) retries the load instead of
   * leaving the image hidden forever (the defect the hand-copied
   * `onerror → display:none` pattern had, see intent-hq/intent#4644).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    /** GitHub login (user or organization) whose avatar is rendered. */
    identity: string;
    provider?: 'github' | 'gitlab' | 'unknown';
    avatarUrl?: string | null;
    /** Rendered size in CSS px; the image is requested at 2x for HiDPI screens. */
    size?: number;
    /** Layout classes for the `<img>` (dimensions, rounding, object-fit). */
    class?: string;
    /**
     * Accessible alt text. Omit to render the avatar as decorative
     * (`alt=""` + `aria-hidden`), which is right whenever adjacent text already
     * names the owner.
     */
    alt?: string;
    /** Rendered in place of the image once it fails to load. */
    fallback?: Snippet;
  }

  let {
    identity,
    provider = 'github',
    avatarUrl,
    size = 16,
    class: className = '',
    alt,
    fallback,
  }: Props = $props();

  let failed = $state(false);
  const src = $derived.by(() => {
    if (avatarUrl) {
      try {
        const url = new URL(avatarUrl);
        if (url.protocol === 'https:' && !url.username && !url.password) return avatarUrl;
      } catch {
        /* Use fallback. */
      }
    }
    return provider === 'github' && /^[A-Za-z0-9-]+$/.test(identity)
      ? `https://github.com/${identity}.png?size=${size * 2}`
      : null;
  });

  $effect.pre(() => {
    void src;
    failed = false;
  });
</script>

{#if failed || !src}
  {#if fallback}
    {@render fallback()}
  {:else}
    <span
      class={`inline-flex shrink-0 items-center justify-center bg-muted text-muted-foreground ${className}`}
      style:font-size={`${Math.max(9, Math.round(size / 2))}px`}
      style:width={`${size}px`}
      style:height={`${size}px`}
      aria-label={alt}
      aria-hidden={alt === undefined ? 'true' : undefined}>{identity.charAt(0).toUpperCase()}</span
    >
  {/if}
{:else}
  <img
    {src}
    width={size}
    height={size}
    alt={alt ?? ''}
    aria-hidden={alt === undefined ? 'true' : undefined}
    class={className}
    loading="lazy"
    onerror={() => {
      failed = true;
    }}
  />
{/if}
