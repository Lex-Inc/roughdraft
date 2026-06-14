import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

type Pose = {
  sh: number;
  el: number;
};

const SHOULDER_L = [270, 230] as const;
const ELBOW_L = [270, 276] as const;
const SHOULDER_R = [410, 230] as const;
const ELBOW_R = [410, 276] as const;

const REST: Pose = { sh: 0, el: 0 };
const COCK: Pose = { sh: -115, el: -80 };
const IMPACT: Pose = { sh: -136, el: 0 };
const RECOIL: Pose = { sh: -131, el: -18 };

function ease(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function replay(el: SVGElement | null, className: string) {
  if (!el) return;
  el.classList.remove(className);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add(className));
  });
}

export function RobotsHighFiveToy({ onHighFive }: { onHighFive?: () => void }) {
  const upperLRef = useRef<SVGGElement | null>(null);
  const foreLRef = useRef<SVGGElement | null>(null);
  const upperRRef = useRef<SVGGElement | null>(null);
  const foreRRef = useRef<SVGGElement | null>(null);
  const bobLRef = useRef<SVGGElement | null>(null);
  const bobRRef = useRef<SVGGElement | null>(null);
  const flashRef = useRef<SVGGElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const currentRef = useRef<Pose>({ ...REST });
  const tokenRef = useRef(0);
  const readyRef = useRef(false);
  const hoveringRef = useRef(false);

  const render = useCallback(() => {
    const current = currentRef.current;
    upperLRef.current?.setAttribute(
      "transform",
      `rotate(${current.sh} ${SHOULDER_L[0]} ${SHOULDER_L[1]})`,
    );
    foreLRef.current?.setAttribute(
      "transform",
      `rotate(${current.el} ${ELBOW_L[0]} ${ELBOW_L[1]})`,
    );
    upperRRef.current?.setAttribute(
      "transform",
      `rotate(${-current.sh} ${SHOULDER_R[0]} ${SHOULDER_R[1]})`,
    );
    foreRRef.current?.setAttribute(
      "transform",
      `rotate(${-current.el} ${ELBOW_R[0]} ${ELBOW_R[1]})`,
    );
  }, []);

  const tweenTo = useCallback(
    (target: Pose, duration: number, token: number) => {
      const from = { ...currentRef.current };
      const start = performance.now();
      return new Promise<void>((resolve) => {
        function step(now: number) {
          if (token !== tokenRef.current) {
            resolve();
            return;
          }

          const progress =
            duration > 0 ? Math.min((now - start) / duration, 1) : 1;
          const eased = ease(progress);
          currentRef.current = {
            sh: from.sh + (target.sh - from.sh) * eased,
            el: from.el + (target.el - from.el) * eased,
          };
          render();

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        }

        requestAnimationFrame(step);
      });
    },
    [render],
  );

  const impactFX = useCallback(() => {
    replay(flashRef.current, "pop");
    replay(bobLRef.current, "hop");
    replay(bobRRef.current, "hop");
  }, []);

  const slap = useCallback(
    async (token: number) => {
      await tweenTo(IMPACT, 110, token);
      if (token !== tokenRef.current) return false;
      impactFX();
      await tweenTo(RECOIL, 90, token);
      if (token !== tokenRef.current) return false;
      await tweenTo({ sh: IMPACT.sh, el: -4 }, 90, token);
      return token === tokenRef.current;
    },
    [impactFX, tweenTo],
  );

  const handleMouseEnter = useCallback(() => {
    if (!readyRef.current) return;
    hoveringRef.current = true;
    const token = ++tokenRef.current;
    void tweenTo(COCK, 260, token);
  }, [tweenTo]);

  const handleMouseLeave = useCallback(() => {
    if (!readyRef.current) return;
    hoveringRef.current = false;
    const token = ++tokenRef.current;
    void tweenTo(REST, 340, token);
  }, [tweenTo]);

  const handleClick = useCallback(async () => {
    onHighFive?.();
    if (!readyRef.current) return;
    const token = ++tokenRef.current;
    if (!(await slap(token))) return;
    await tweenTo(hoveringRef.current ? COCK : REST, 240, token);
  }, [onHighFive, slap, tweenTo]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void handleClick();
    },
    [handleClick],
  );

  useEffect(() => {
    render();
    const token = ++tokenRef.current;
    const isCurrent = () => token === tokenRef.current;

    async function intro() {
      await wait(500);
      if (!isCurrent()) return;
      await tweenTo(COCK, 380, token);
      await wait(240);
      if (!isCurrent()) return;
      await slap(token);
      await wait(160);
      if (!isCurrent()) return;
      await tweenTo(REST, 440, token);
      if (!isCurrent()) return;
      readyRef.current = true;
      if (svgRef.current?.matches(":hover")) {
        hoveringRef.current = true;
        const hoverToken = ++tokenRef.current;
        void tweenTo(COCK, 260, hoverToken);
      }
    }

    void intro();

    return () => {
      tokenRef.current += 1;
      readyRef.current = false;
    };
  }, [render, slap, tweenTo]);

  return (
    <button
      type="button"
      aria-label="High five the robots"
      className="h-full w-full cursor-pointer appearance-none rounded-[7px] border-0 bg-transparent p-0 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/25 dark:focus-visible:ring-slate-50/30"
      data-testid="review-handoff-robots-toy"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => void handleClick()}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 680 380"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby="robots-high-five-title robots-high-five-desc"
        className="review-handoff-robots h-full w-full"
      >
        <title id="robots-high-five-title">Two robots high-fiving</title>
        <desc id="robots-high-five-desc">
          Two cartoon robots swing their arms up to meet in a high five, with a
          sparkle flash at the moment of contact.
        </desc>

        <ellipse cx="230" cy="340" rx="56" ry="10" fill="rgba(0,0,0,0.13)" />
        <ellipse cx="450" cy="340" rx="56" ry="10" fill="rgba(0,0,0,0.13)" />

        <g className="bot-l">
          <rect x="212" y="300" width="16" height="28" rx="4" fill="#3E5A77" />
          <rect x="232" y="300" width="16" height="28" rx="4" fill="#3E5A77" />
          <g ref={bobLRef} className="bob-l">
            <rect
              x="182.5"
              y="230"
              width="15"
              height="46"
              rx="7.5"
              fill="#6E8FB0"
              stroke="#3E5A77"
              strokeWidth="2"
            />
            <g transform="rotate(16 190 276)">
              <rect
                x="182.5"
                y="276"
                width="15"
                height="44"
                rx="7.5"
                fill="#6E8FB0"
                stroke="#3E5A77"
                strokeWidth="2"
              />
              <circle
                cx="190"
                cy="320"
                r="11"
                fill="#7E9DBC"
                stroke="#3E5A77"
                strokeWidth="2"
              />
            </g>
            <circle
              cx="190"
              cy="276"
              r="8"
              fill="#6E8FB0"
              stroke="#3E5A77"
              strokeWidth="2"
            />
            <rect
              x="195"
              y="222"
              width="70"
              height="82"
              rx="14"
              fill="#6E8FB0"
              stroke="#3E5A77"
              strokeWidth="2"
            />
            <rect
              x="215"
              y="244"
              width="30"
              height="26"
              rx="4"
              fill="#3E5A77"
            />
            <circle cx="223" cy="257" r="2.5" fill="#E8A23D" />
            <circle cx="237" cy="257" r="2.5" fill="#7ECBC4" />
            <rect
              x="202"
              y="178"
              width="56"
              height="44"
              rx="12"
              fill="#7E9DBC"
              stroke="#3E5A77"
              strokeWidth="2"
            />
            <line
              x1="230"
              y1="178"
              x2="230"
              y2="162"
              stroke="#3E5A77"
              strokeWidth="3"
            />
            <circle cx="230" cy="158" r="5" fill="#E8A23D" />
            <circle
              cx="218"
              cy="200"
              r="8"
              fill="#fff"
              stroke="#3E5A77"
              strokeWidth="1.5"
            />
            <circle cx="218" cy="200" r="3.5" fill="#1F3346" />
            <circle
              cx="242"
              cy="200"
              r="8"
              fill="#fff"
              stroke="#3E5A77"
              strokeWidth="1.5"
            />
            <circle cx="242" cy="200" r="3.5" fill="#1F3346" />
            <rect
              x="220"
              y="212"
              width="20"
              height="3"
              rx="1.5"
              fill="#3E5A77"
            />
          </g>
          <g ref={upperLRef} data-robot-part="upper-left-arm">
            <rect
              x="262"
              y="230"
              width="16"
              height="46"
              rx="8"
              fill="#6E8FB0"
              stroke="#3E5A77"
              strokeWidth="2"
            />
            <g ref={foreLRef} data-robot-part="fore-left-arm">
              <rect
                x="262"
                y="276"
                width="16"
                height="44"
                rx="8"
                fill="#6E8FB0"
                stroke="#3E5A77"
                strokeWidth="2"
              />
              <circle
                cx="270"
                cy="320"
                r="13"
                fill="#7E9DBC"
                stroke="#3E5A77"
                strokeWidth="2"
              />
            </g>
            <circle
              cx="270"
              cy="276"
              r="9"
              fill="#6E8FB0"
              stroke="#3E5A77"
              strokeWidth="2"
            />
          </g>
        </g>

        <g className="bot-r">
          <rect x="432" y="300" width="16" height="28" rx="4" fill="#8A4A40" />
          <rect x="452" y="300" width="16" height="28" rx="4" fill="#8A4A40" />
          <g ref={bobRRef} className="bob-r">
            <rect
              x="482.5"
              y="230"
              width="15"
              height="46"
              rx="7.5"
              fill="#C97B6E"
              stroke="#8A4A40"
              strokeWidth="2"
            />
            <g transform="rotate(-16 490 276)">
              <rect
                x="482.5"
                y="276"
                width="15"
                height="44"
                rx="7.5"
                fill="#C97B6E"
                stroke="#8A4A40"
                strokeWidth="2"
              />
              <circle
                cx="490"
                cy="320"
                r="11"
                fill="#D88E80"
                stroke="#8A4A40"
                strokeWidth="2"
              />
            </g>
            <circle
              cx="490"
              cy="276"
              r="8"
              fill="#C97B6E"
              stroke="#8A4A40"
              strokeWidth="2"
            />
            <rect
              x="415"
              y="222"
              width="70"
              height="82"
              rx="14"
              fill="#C97B6E"
              stroke="#8A4A40"
              strokeWidth="2"
            />
            <rect
              x="435"
              y="244"
              width="30"
              height="26"
              rx="4"
              fill="#8A4A40"
            />
            <circle cx="443" cy="257" r="2.5" fill="#7ECBC4" />
            <circle cx="457" cy="257" r="2.5" fill="#E8A23D" />
            <rect
              x="422"
              y="178"
              width="56"
              height="44"
              rx="12"
              fill="#D88E80"
              stroke="#8A4A40"
              strokeWidth="2"
            />
            <line
              x1="450"
              y1="178"
              x2="450"
              y2="162"
              stroke="#8A4A40"
              strokeWidth="3"
            />
            <circle cx="450" cy="158" r="5" fill="#7ECBC4" />
            <circle
              cx="438"
              cy="200"
              r="8"
              fill="#fff"
              stroke="#8A4A40"
              strokeWidth="1.5"
            />
            <circle cx="438" cy="200" r="3.5" fill="#4A211C" />
            <circle
              cx="462"
              cy="200"
              r="8"
              fill="#fff"
              stroke="#8A4A40"
              strokeWidth="1.5"
            />
            <circle cx="462" cy="200" r="3.5" fill="#4A211C" />
            <rect
              x="440"
              y="212"
              width="20"
              height="3"
              rx="1.5"
              fill="#8A4A40"
            />
          </g>
          <g ref={upperRRef} data-robot-part="upper-right-arm">
            <rect
              x="402"
              y="230"
              width="16"
              height="46"
              rx="8"
              fill="#C97B6E"
              stroke="#8A4A40"
              strokeWidth="2"
            />
            <g ref={foreRRef} data-robot-part="fore-right-arm">
              <rect
                x="402"
                y="276"
                width="16"
                height="44"
                rx="8"
                fill="#C97B6E"
                stroke="#8A4A40"
                strokeWidth="2"
              />
              <circle
                cx="410"
                cy="320"
                r="13"
                fill="#D88E80"
                stroke="#8A4A40"
                strokeWidth="2"
              />
            </g>
            <circle
              cx="410"
              cy="276"
              r="9"
              fill="#C97B6E"
              stroke="#8A4A40"
              strokeWidth="2"
            />
          </g>
        </g>

        <g ref={flashRef} className="flash">
          <g stroke="#E8A23D" strokeWidth="3" strokeLinecap="round">
            <line x1="340" y1="133" x2="340" y2="119" />
            <line x1="340" y1="197" x2="340" y2="211" />
            <line x1="308" y1="165" x2="294" y2="165" />
            <line x1="372" y1="165" x2="386" y2="165" />
            <line x1="318" y1="143" x2="308" y2="133" />
            <line x1="362" y1="143" x2="372" y2="133" />
            <line x1="318" y1="187" x2="308" y2="197" />
            <line x1="362" y1="187" x2="372" y2="197" />
          </g>
          <circle cx="302" cy="147" r="3" fill="#7ECBC4" />
          <circle cx="378" cy="183" r="3" fill="#7ECBC4" />
          <circle cx="380" cy="145" r="2.5" fill="#E8A23D" />
          <circle cx="300" cy="185" r="2.5" fill="#E8A23D" />
        </g>
      </svg>
    </button>
  );
}
