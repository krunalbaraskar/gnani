import { useRef } from 'react';

/**
 * Bottom-right resize handle. Transparent frameless windows on Windows don't always get
 * native resize borders, so resizing is done by asking the main process to set the size.
 */
export function ResizeGrip() {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <div
      className="resize-grip"
      title="Drag to resize"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        window.bolo.window({
          kind: 'resize',
          width: s.w + e.screenX - s.x,
          height: s.h + e.screenY - s.y,
        });
      }}
      onPointerUp={() => (start.current = null)}
    />
  );
}
