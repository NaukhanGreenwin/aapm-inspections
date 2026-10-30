import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.35,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
});

export const IconLock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="5" y="10.5" width="14" height="10" rx="1.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2.5" /></svg>
);
export const IconPhone = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6.6 3.5h2.6l1.4 4.2-2 1.4a12 12 0 0 0 6.3 6.3l1.4-2 4.2 1.4v2.6a1.6 1.6 0 0 1-1.7 1.6A15.6 15.6 0 0 1 5 5.2 1.6 1.6 0 0 1 6.6 3.5Z" /></svg>
);
export const IconArrowRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" /></svg>
);
export const IconArrowLeft = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><polyline points="4.5,12.8 9.6,17.6 19.5,6.2" /></svg>
);
export const IconCamera = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13.3" r="3.4" /></svg>
);
export const IconImages = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3.5" y="5" width="17" height="14" rx="1.2" /><circle cx="9" cy="10" r="1.6" /><path d="m3.5 16.5 5-4.5 4 3.5 3-2.5 5 4" /></svg>
);
export const IconClose = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
);
export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8.5 6.5v11l9-5.5-9-5.5Z" /></svg>
);
export const IconList = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r="0.9" /><circle cx="4.8" cy="12" r="0.9" /><circle cx="4.8" cy="17.5" r="0.9" /></svg>
);
export const IconNote = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 4.5h14v10.5l-4.5 4.5H5Z" /><path d="M14.5 19.5V15H19" /><path d="M8.5 9h7M8.5 12h4.5" /></svg>
);
export const IconShield = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z" /><polyline points="9,12.2 11.2,14.3 15.2,9.8" /></svg>
);

/* Category marks - fine single-weight line drawings */
export const CategoryIcon = ({ name, size = 28 }: { name: string; size?: number }) => {
  const b = base(size);
  switch (name) {
    case "plumbing":
      return <svg {...b}><path d="M12 3.5c3 4 5.5 7.1 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 10.6 9 7.5 12 3.5Z" /><path d="M9.4 14.2a2.7 2.7 0 0 0 2.6 2.6" /></svg>;
    case "electrical":
      return <svg {...b}><path d="M13.2 3 6 13.2h5.3L10.6 21 18 10.7h-5.3L13.2 3Z" /></svg>;
    case "heating-cooling":
      return <svg {...b}><path d="M10 14.6V5a2 2 0 0 1 4 0v9.6a4 4 0 1 1-4 0Z" /><path d="M12 9.5v6.8" /><path d="M17.5 6h2.5M17.5 9h2.5" /></svg>;
    case "appliance":
      return <svg {...b}><rect x="6" y="3" width="12" height="18" rx="1.4" /><path d="M6 9.5h12M9 6v1.5M9 12.5v3" /></svg>;
    case "pest":
      return <svg {...b}><ellipse cx="12" cy="13.5" rx="4" ry="5.5" /><path d="M12 8V19M10 6.5 8.5 4.5M14 6.5l1.5-2M8 11.5 4.5 10M8 15H4.5M8.4 18l-3 1.8M16 11.5l3.5-1.5M16 15h3.5M15.6 18l3 1.8" /><circle cx="12" cy="7.2" r="1.8" /></svg>;
    case "locks-doors":
      return <svg {...b}><circle cx="8" cy="12" r="3.8" /><path d="M11.8 12H20.5M17.5 12v3M20 12v2.2" /></svg>;
    case "walls-floors":
      return <svg {...b}><path d="M3.5 6h17M3.5 10.5h17M3.5 15h17M3.5 19.5h17M8.5 6v4.5M15.5 6v4.5M12 10.5V15M5.5 15v4.5M18.5 15v4.5" /></svg>;
    case "alarms":
      return <svg {...b}><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.2" /><path d="M8.6 5.4 9.4 7M15.4 5.4 14.6 7" /></svg>;
    default:
      return <svg {...b}><circle cx="6.5" cy="12" r="1.1" /><circle cx="12" cy="12" r="1.1" /><circle cx="17.5" cy="12" r="1.1" /></svg>;
  }
};
