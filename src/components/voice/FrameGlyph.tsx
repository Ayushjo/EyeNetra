/**
 * Line drawing of a frame front by shape — the shortlist thumbnails. Cheap
 * (one SVG, no extra WebGL context) and reads instantly at 40 px.
 */
const LENS: Record<string, string> = {
  round: "M0,0 a13,13 0 1,0 26,0 a13,13 0 1,0 -26,0",
  oval: "M0,0 a13,10 0 1,0 26,0 a13,10 0 1,0 -26,0",
  aviator: "M0,-8 C0,-12 26,-12 26,-7 C26,4 20,12 12,12 C4,12 0,4 0,-8 Z",
  square: "M0,-10 h26 v19 a2,2 0 0 1 -2,2 h-22 a2,2 0 0 1 -2,-2 Z",
  rectangular: "M0,-8 h26 v14 a3,3 0 0 1 -3,3 h-20 a3,3 0 0 1 -3,-3 Z",
  "cat-eye": "M0,-4 C2,-12 20,-11 27,-12 C26,2 20,10 11,10 C4,10 0,5 0,-4 Z",
};

export function FrameGlyph({
  shape,
  color = "currentColor",
  className = "",
}: {
  shape?: string;
  color?: string;
  className?: string;
}) {
  const d = LENS[shape ?? ""] ?? LENS.rectangular;
  return (
    <svg viewBox="-4 -16 70 34" className={className} aria-hidden>
      <g fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round">
        <path d={d} transform="translate(2,0)" />
        {/* Right lens: mirror of the left. */}
        <path d={d} transform="translate(62,0) scale(-1,1)" />
        <path d="M28,-6 Q32,-10 36,-6" />
        <path d="M2,-7 L-3,-9 M62,-7 L67,-9" />
      </g>
    </svg>
  );
}
