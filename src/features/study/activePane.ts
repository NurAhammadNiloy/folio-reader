/**
 * Which side of the Study view the person last worked in. Keyboard shortcuts such as
 * Ctrl+Z and the arrow keys apply to that side only (drawing on a canvas does not move
 * focus, so document focus alone cannot tell).
 */
let active: 'book' | 'notebook' = 'book';

export const setActivePane = (p: 'book' | 'notebook') => {
  active = p;
};
export const activePane = () => active;
