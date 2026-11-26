import { memo } from 'react';
import { StickyNote } from 'lucide-react';
import type { SpaceTransform } from '../../core/ink/geometry';
import type { TextMarkRecord } from '../../core/storage/types';
import { toViewBox } from './marks';

/**
 * Text highlights and underlines painted under the text layer (so selection still works)
 * and note pins above it. Boxes are stored in PDF space and mapped through the page's
 * current viewport, so they follow zoom and rotation.
 */
export const MarksLayer = memo(function MarksLayer({
  marks,
  transform,
  onOpen,
}: {
  marks: TextMarkRecord[];
  transform: SpaceTransform;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="marks-layer" aria-hidden data-testid="marks-layer">
        {marks.flatMap((m) =>
          m.rects.map((r, i) => {
            const [x0, y0, x1, y1] = toViewBox(transform, r);
            return (
              <div
                key={`${m.id}-${i}`}
                data-mark-id={m.id}
                className={`text-mark text-mark-${m.kind}`}
                style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0, ['--mark' as string]: m.color }}
              />
            );
          }),
        )}
      </div>
      {marks
        .filter((m) => m.note.trim() || m.kind === 'note')
        .map((m) => {
          const [, y0, x1] = toViewBox(transform, m.rects[0]!);
          return (
            <button
              key={m.id}
              type="button"
              className="note-pin"
              style={{ left: x1, top: y0, ['--mark' as string]: m.color }}
              aria-label={`Note: ${m.note.trim().slice(0, 80) || m.text.slice(0, 80)}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(m.id);
              }}
            >
              <StickyNote size={14} aria-hidden />
            </button>
          );
        })}
    </>
  );
});
