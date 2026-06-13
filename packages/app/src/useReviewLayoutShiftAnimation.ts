import { useLayoutEffect, useRef, type RefObject } from "react";

const animationClass = "review-layout-grid--animating";
const shiftProperty = "--review-layout-shift-x";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const animationDurationMs = 180;

export function useReviewLayoutShiftAnimation<TElement extends HTMLElement>(
  layoutState: unknown,
): RefObject<TElement | null> {
  const elementRef = useRef<TElement>(null);
  const previousLeftRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    void layoutState;

    const element = elementRef.current;
    const main = element?.querySelector<HTMLElement>(".review-layout-main");
    if (!element || !main) return;

    const nextLeft = main.getBoundingClientRect().left;
    const previousLeft = previousLeftRef.current;
    previousLeftRef.current = nextLeft;

    if (previousLeft === null) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia(reducedMotionQuery).matches
    ) {
      return;
    }

    const deltaX = previousLeft - nextLeft;
    if (Math.abs(deltaX) < 1) return;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      element.classList.remove(animationClass);
      element.style.removeProperty(shiftProperty);
      element.removeEventListener("transitionend", handleTransitionEnd);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === "transform") {
        finish();
      }
    };

    element.classList.remove(animationClass);
    element.style.setProperty(shiftProperty, `${deltaX}px`);
    void element.offsetWidth;
    element.classList.add(animationClass);
    element.addEventListener("transitionend", handleTransitionEnd);

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      element.style.setProperty(shiftProperty, "0px");
    });
    timeoutRef.current = window.setTimeout(finish, animationDurationMs + 100);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      finish();
    };
  }, [layoutState]);

  return elementRef;
}
