import { useEffect, type RefObject } from "react";

/**
 * Linear's board auto-scroll while a card is dragged (IssueList.CUOYX8Am.js `Yc`, `Xc`): every frame, an edge the pointer
 * is moving towards scrolls when the pointer is within 250px of it (150px on a phone), at up to 45px a frame (35 on a
 * phone), easing in by the cube of how close it is. A scrollable column under the pointer scrolls first; else the board's
 * own scroller, both ways.
 *
 * Ours because React Aria's drop auto-scroll (`useAutoScroll`) runs only in WebKit, 20px from the edge, and leaves Chrome
 * to the browser's own drag scrolling.
 */
export function edgeSpeed(distance: number, phone: boolean) {
  const zone = phone ? 150 : 250;
  return distance > zone ? 0 : (phone ? 35 : 45) * (1 - Math.max(0, distance) / zone) ** 3;
}

/** The scroll step along one axis: towards the edge the pointer last moved to, by its distance to that edge. */
export function axisStep(direction: number, toStart: number, toEnd: number, phone: boolean) {
  return direction < 0 ? -edgeSpeed(toStart, phone) : direction > 0 ? edgeSpeed(toEnd, phone) : 0;
}

const scrollsY = (node: Element) => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight;

/** Runs while a native drag that started inside `scroller` is under way (React Aria's mouse drags are native drags). */
export function useDragAutoScroll(scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    type Point = { x: number; y: number };
    let frame = 0, pointer: Point | null = null, last: Point | null = null, direction: Point = { x: 0, y: 0 };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const board = scroller.current;
      if (!board || !pointer) return;
      if (last) {
        const dx = Math.sign(pointer.x - last.x), dy = Math.sign(pointer.y - last.y);
        direction = { x: dx || direction.x, y: dy || direction.y };
      }
      last = pointer;
      const phone = innerWidth < 640;
      let column = document.elementFromPoint(pointer.x, pointer.y);
      while (column && column !== board && !scrollsY(column)) column = column.parentElement;
      if (column && column !== board && board.contains(column)) {
        const r = column.getBoundingClientRect();
        const step = axisStep(direction.y, pointer.y - r.top, r.bottom - pointer.y, phone);
        if (step) return column.scrollBy({ top: step });
      }
      const r = board.getBoundingClientRect();
      board.scrollBy({
        left: axisStep(direction.x, pointer.x - r.left, r.right - pointer.x, phone),
        top: axisStep(direction.y, pointer.y - r.top, r.bottom - pointer.y, phone),
      });
    };
    const over = (event: DragEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const start = (event: DragEvent) => {
      if (!scroller.current?.contains(event.target as Node)) return;
      pointer = last = null;
      direction = { x: 0, y: 0 };
      addEventListener("dragover", over, true);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      removeEventListener("dragover", over, true);
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
    };
    addEventListener("dragstart", start, true);
    addEventListener("dragend", stop, true);
    addEventListener("drop", stop, true);
    return () => {
      stop();
      removeEventListener("dragstart", start, true);
      removeEventListener("dragend", stop, true);
      removeEventListener("drop", stop, true);
    };
  }, [scroller]);
}
