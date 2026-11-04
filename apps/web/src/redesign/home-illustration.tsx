import { useId } from "react";

/** Decorative report/calendar artwork; it never represents a measured value. */
export default function BriefingIllustration() {
  const id = useId();
  const paper = `${id}-paper`;
  const blue = `${id}-blue`;
  const pale = `${id}-pale`;
  const shadow = `${id}-shadow`;
  const calendarShadow = `${id}-calendar-shadow`;

  return (
    <svg
      className="rd-home-illustration"
      width="210"
      height="180"
      viewBox="0 0 210 180"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={paper} x1="18" y1="0" x2="96" y2="126" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="0.6" stopColor="#F8FAFF" />
          <stop offset="1" stopColor="#E2E9FF" />
        </linearGradient>
        <linearGradient id={blue} x1="0" y1="0" x2="54" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#92AEFF" />
          <stop offset="0.5" stopColor="#628BFF" />
          <stop offset="1" stopColor="#3659F8" />
        </linearGradient>
        <linearGradient id={pale} x1="0" y1="0" x2="65" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8EEFF" />
          <stop offset="1" stopColor="#C7D5FF" />
        </linearGradient>
        <filter id={shadow} x="-45%" y="-30%" width="200%" height="190%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="7" dy="10" stdDeviation="8" floodColor="#5076E9" floodOpacity="0.25" />
        </filter>
        <filter id={calendarShadow} x="-50%" y="-40%" width="210%" height="210%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="4" dy="6" stdDeviation="4" floodColor="#375DE1" floodOpacity="0.27" />
        </filter>
      </defs>

      <g transform="matrix(.96 .23 -.34 .94 65 10)" filter={`url(#${shadow})`}>
        <rect x="2" y="4" width="104" height="124" rx="5" fill="#CFDBFF" />
        <rect width="104" height="124" rx="5" fill={`url(#${paper})`} />
        <rect x="1" y="1" width="102" height="122" rx="4" stroke="white" strokeOpacity="0.75" />
        <rect x="13" y="13" width="69" height="7" rx="1.2" fill={`url(#${blue})`} />
        <rect x="13" y="25" width="45" height="5" rx="1" fill="#9EB8FF" />
        <rect x="13" y="39" width="76" height="4" rx="1" fill="#D9E2FC" />
        <rect x="13" y="47" width="54" height="4" rx="1" fill="#E0E7FB" />
        <g transform="translate(15 62)">
          <rect y="16" width="13" height="15" rx="1.3" fill={`url(#${blue})`} />
          <rect x="21" y="8" width="13" height="23" rx="1.3" fill={`url(#${blue})`} />
          <rect x="42" width="13" height="31" rx="1.3" fill={`url(#${blue})`} />
          <rect x="63" y="8" width="13" height="23" rx="1.3" fill={`url(#${blue})`} />
          <path d="M1 17v12M22 9v20M43 1v28M64 9v20" stroke="white" strokeOpacity="0.5" />
        </g>
        <rect x="13" y="101" width="76" height="4" rx="1" fill="#DCE5FF" />
        <rect x="13" y="110" width="46" height="4" rx="1" fill="#E1E8FB" />
      </g>

      <g transform="matrix(.96 .23 -.26 .96 126 85)" filter={`url(#${calendarShadow})`}>
        <rect x="2" y="3" width="68" height="64" rx="7" fill="#CDD9FF" />
        <rect width="68" height="64" rx="7" fill={`url(#${paper})`} />
        <path d="M7 0h54a7 7 0 0 1 7 7v13H0V7a7 7 0 0 1 7-7Z" fill={`url(#${blue})`} />
        <path d="M2 20h64" stroke="#99B4FF" strokeOpacity="0.6" />
        <rect x="13" y="-7" width="5" height="15" rx="2.5" fill="#B9CAFF" />
        <rect x="49" y="-7" width="5" height="15" rx="2.5" fill="#B9CAFF" />
        <path d="M14-4v9M50-4v9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
        {[26, 38, 50].flatMap((y, row) =>
          [10, 26, 42].map((x, column) => (
            <rect
              key={`${row}-${column}`}
              x={x}
              y={y}
              width="12"
              height="8"
              rx="1.2"
              fill={`url(#${pale})`}
            />
          )),
        )}
      </g>
    </svg>
  );
}
