import { useId, type SVGProps } from 'react';

type BrandMarkProps = SVGProps<SVGSVGElement> & { animated?: boolean };

// Locatto's mark: a contract sheet with a roof — the same drawing as public/favicon.svg,
// minus the blue tile. Filled with currentColor so it sizes/colors like a lucide icon;
// the text lines are cut out through a mask, so they show whatever is behind the mark.
// `animated` pulses those lines (brand-window keyframes in index.css) for BrandLoader.
export default function BrandMark({ animated = false, ...props }: BrandMarkProps) {
  // useId() output contains characters that aren't safe inside url(#…)
  const maskId = `brand-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const lineStyle = (i: number) =>
    animated
      ? { animation: 'brand-window 2.2s ease-in-out infinite', animationDelay: `${i * 0.16}s` }
      : undefined;

  return (
    <svg viewBox="3.5 3.5 25 25" fill="currentColor" aria-hidden="true" {...props}>
      <mask id={maskId}>
        <path d="M7.5 13.5 16 6l8.5 7.5V26h-17Z" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M11.5 17.5h9" stroke="#000" strokeWidth="2.2" strokeLinecap="round" style={lineStyle(0)} />
        <path d="M11.5 21.5h6" stroke="#000" strokeWidth="2.2" strokeLinecap="round" style={lineStyle(1)} />
      </mask>
      <rect x="3.5" y="3.5" width="25" height="25" mask={`url(#${maskId})`} />
    </svg>
  );
}
