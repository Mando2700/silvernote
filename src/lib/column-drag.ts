'use client';

import { useState, type DragEvent, type PointerEvent } from 'react';

/**
 * Drag-to-reorder for table headers. Spread `headerProps(key)` on each draggable header and render
 * columns in the returned `order`: it previews the move while dragging, and `onReorder` receives the
 * final order once, on drop. Drags that start on a column resize handle (`.cursor-col-resize`) are ignored.
 */
export function useColumnDrag<K extends string>(saved: readonly K[], onReorder: (next: K[]) => void) {
  const [dragged, setDragged] = useState<K | null>(null);
  const [preview, setPreview] = useState<K[] | null>(null);
  const [blocked, setBlocked] = useState(false);
  const order = preview ?? saved;
  return {
    order,
    dragged,
    headerProps: (key: K) => ({
      draggable: true,
      onPointerDownCapture: (event: PointerEvent) => setBlocked(Boolean((event.target as HTMLElement).closest('.cursor-col-resize'))),
      onDragStart: (event: DragEvent) => {
        if (blocked) return event.preventDefault();
        setDragged(key);
        event.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (event: DragEvent) => {
        if (!dragged || !order.includes(key)) return;
        event.preventDefault();
        if (dragged === key) return;
        const next = order.filter((item) => item !== dragged);
        next.splice(order.indexOf(key), 0, dragged);
        setPreview(next);
      },
      onDragEnd: () => {
        if (preview && preview.join() !== saved.join()) onReorder(preview);
        setDragged(null);
        setPreview(null);
      },
    }),
  };
}
