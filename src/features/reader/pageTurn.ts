/**
 * Page-turn animation (RDR-06). A snapshot of the outgoing page is laid over the
 * reader and lifted around its spine edge with perspective, a moving highlight on
 * the leaf and a shadow cast on the page underneath. The new page is already in
 * place below, so the turn never delays reading and input is never blocked.
 * Callers skip it when the person or the system asks for reduced motion.
 */
export type PageTurnStyle = 'curl' | 'slide';

const DURATION = 460;

/**
 * @param snapshot an element that paints the outgoing page at (0,0)-(rect.width, rect.height)
 * @param rect where the outgoing page was on screen
 * @param hinge which edge the leaf turns around ('left' for a forward turn in left-to-right books)
 */
export function playPageTurn(snapshot: HTMLElement, rect: DOMRect, hinge: 'left' | 'right'): void {
  if (rect.width < 8 || rect.height < 8 || typeof snapshot.animate !== 'function') return;
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.className = 'folio-turn-stage';
  Object.assign(stage.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const leaf = document.createElement('div');
  leaf.className = 'folio-turn-leaf';
  leaf.style.transformOrigin = `${hinge} center`;
  snapshot.style.position = 'absolute';
  snapshot.style.inset = '0';
  const sheen = document.createElement('div');
  sheen.className = 'folio-turn-sheen';
  sheen.style.background =
    hinge === 'left'
      ? 'linear-gradient(to left, rgba(0,0,0,0.28), rgba(0,0,0,0.04) 35%, rgba(255,255,255,0.10) 70%, rgba(0,0,0,0.12))'
      : 'linear-gradient(to right, rgba(0,0,0,0.28), rgba(0,0,0,0.04) 35%, rgba(255,255,255,0.10) 70%, rgba(0,0,0,0.12))';
  const cast = document.createElement('div');
  cast.className = 'folio-turn-cast';
  cast.style.background = `linear-gradient(to ${hinge}, rgba(0,0,0,0) 0%, rgba(0,0,0,0.22) 100%)`;
  leaf.append(snapshot, sheen);
  stage.append(cast, leaf);
  document.body.append(stage);

  const sign = hinge === 'left' ? -1 : 1;
  const easing = 'cubic-bezier(0.45, 0.05, 0.35, 1)';
  const anims = [
    leaf.animate(
      [
        { transform: 'rotateY(0deg) translateZ(0)', filter: 'brightness(1)' },
        { transform: `rotateY(${sign * 35}deg) translateZ(18px)`, filter: 'brightness(1.03)', offset: 0.35 },
        { transform: `rotateY(${sign * 96}deg) translateZ(0)`, filter: 'brightness(0.82)' },
      ],
      { duration: DURATION, easing, fill: 'forwards' },
    ),
    sheen.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], { duration: DURATION, easing, fill: 'forwards' }),
    cast.animate([{ opacity: 0.9 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }], { duration: DURATION, easing, fill: 'forwards' }),
  ];
  const done = () => stage.remove();
  void anims[0]!.finished.then(done, done);
  // Safety net if the animation is interrupted (tab hidden, element detached).
  setTimeout(done, DURATION + 400);
}

/** Copy the canvases inside `page` into a snapshot positioned relative to `origin`. */
export function snapshotCanvases(page: HTMLElement, pageRect: DOMRect, origin: DOMRect): HTMLElement | null {
  const box = document.createElement('div');
  let painted = false;
  for (const c of page.querySelectorAll('canvas')) {
    if (!c.width || !c.height) continue;
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext('2d');
    if (!ctx) continue;
    try {
      ctx.drawImage(c, 0, 0);
    } catch {
      continue;
    }
    painted = true;
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${pageRect.left - origin.left}px`,
      top: `${pageRect.top - origin.top}px`,
      width: `${pageRect.width}px`,
      height: `${pageRect.height}px`,
    });
    box.append(copy);
  }
  if (!painted) return null;
  box.style.background = '#fff';
  return box;
}
