import type { Action } from 'svelte/action';

interface Walkthrough {
  root: HTMLElement;
  slot: HTMLElement;
  footer: HTMLElement;
}

// TipTap mounts node views as separate Svelte roots. Keep this bridge DOM-local,
// rather than using a shared store or assuming Svelte context crosses that boundary.
export function createNoteDiagramControlsHost(scrollport: HTMLElement, band: HTMLElement) {
  let active: Walkthrough | undefined;
  let preferred: HTMLElement | undefined;
  let frame: number | undefined;
  let destroyed = false;
  const observed = new Set<Element>();

  function move(footer: HTMLElement, destination: HTMLElement) {
    const focused = footer.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : undefined;
    destination.appendChild(footer);
    // appendChild may blur a focused button; restore the same control without
    // scrolling its former note position back into view.
    focused?.focus({ preventScroll: true });
  }

  function release() {
    if (!active) return;
    const previous = active;
    const wasFocused = previous.footer.contains(document.activeElement);
    active = undefined;
    if (scrollport.contains(previous.slot)) move(previous.footer, previous.slot);
    else previous.footer.remove();
    previous.slot.style.removeProperty('height');
    delete previous.root.dataset.controlsInNoteBand;
    band.hidden = true;
    // Exiting the walkthrough should not leave focus on a hidden/detached
    // control (or reset it to the document). Keep keyboard context in this note.
    if (
      wasFocused &&
      scrollport.isConnected &&
      (scrollport.hasAttribute('data-diagram-controls-host') ||
        !previous.footer.contains(document.activeElement))
    ) {
      const tabIndex = scrollport.getAttribute('tabindex');
      scrollport.tabIndex = -1;
      scrollport.focus({ preventScroll: true });
      if (tabIndex === null) scrollport.removeAttribute('tabindex');
      else scrollport.setAttribute('tabindex', tabIndex);
    }
  }

  function visible(root: HTMLElement) {
    for (let node: HTMLElement | null = root; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
      if (node === scrollport) break;
    }
    return root.getClientRects().length > 0;
  }

  function update() {
    frame = undefined;
    if (destroyed) return;
    const entries = [...scrollport.querySelectorAll<HTMLElement>('.diagram-controls-slot')]
      .map((slot): Walkthrough | undefined => {
        const root = slot.closest<HTMLElement>('.stateful-diagram');
        const footer =
          active?.slot === slot
            ? active.footer
            : slot.querySelector<HTMLElement>('.diagram-footer');
        return root && footer ? { root, slot, footer } : undefined;
      })
      .filter((entry): entry is Walkthrough => Boolean(entry));
    const currentRoots = new Set(entries.map(({ root }) => root));
    for (const root of observed) {
      if (!currentRoots.has(root as HTMLElement)) {
        resize.unobserve(root);
        observed.delete(root);
      }
    }
    for (const { root } of entries) {
      if (!observed.has(root)) {
        observed.add(root);
        resize.observe(root);
      }
    }
    const port = scrollport.getBoundingClientRect();
    // Use the potential band boundary even while the band is absent. Reserving
    // the band then cannot make its activating diagram disappear and oscillate.
    const hostBottom = band.parentElement?.getBoundingClientRect().bottom ?? port.bottom;
    const candidates = entries.filter(({ root, footer }) => {
      if (!visible(root)) return false;
      const rect = root.getBoundingClientRect();
      const bandHeight = footer.getBoundingClientRect().height;
      return rect.bottom > port.top + 1 && rect.top < hostBottom - bandHeight - 1;
    });
    const next =
      candidates.find(({ root }) => root === preferred) ??
      candidates.find(({ root }) => root === active?.root) ??
      candidates[0];
    preferred = undefined;
    if (next?.root !== active?.root) {
      release();
      if (next) {
        next.slot.style.height = `${next.footer.getBoundingClientRect().height}px`;
        active = next;
        next.root.dataset.controlsInNoteBand = 'true';
        band.hidden = false;
        move(next.footer, band);
      }
    }
    if (active) {
      const height = `${active.footer.getBoundingClientRect().height}px`;
      if (active.slot.style.height !== height) active.slot.style.height = height;
    }
  }

  function schedule() {
    if (!destroyed && frame === undefined) frame = requestAnimationFrame(update);
  }

  function prefer(event: Event) {
    const target = event.target;
    if (target instanceof Element) {
      preferred = target.closest<HTMLElement>('.stateful-diagram') ?? undefined;
      if (preferred) schedule();
    }
  }

  const resize = new ResizeObserver(schedule);
  resize.observe(scrollport);
  resize.observe(band);
  const mutations = new MutationObserver(schedule);
  mutations.observe(scrollport, { childList: true, subtree: true });
  mutations.observe(band, { childList: true, subtree: true });
  scrollport.dataset.diagramControlsHost = 'true';
  scrollport.addEventListener('scroll', schedule, { passive: true });
  scrollport.addEventListener('focusin', prefer);
  scrollport.addEventListener('pointerdown', prefer);
  schedule();

  return () => {
    destroyed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    scrollport.removeEventListener('scroll', schedule);
    scrollport.removeEventListener('focusin', prefer);
    scrollport.removeEventListener('pointerdown', prefer);
    delete scrollport.dataset.diagramControlsHost;
    release();
  };
}

// Ensure a portaled footer cannot survive destruction of its renderer/node view.
export const walkthroughFooter: Action<HTMLElement> = (footer) => ({
  destroy() {
    if (footer.parentElement?.hasAttribute('data-note-diagram-band')) footer.remove();
  },
});
