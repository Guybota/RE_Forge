// Small line icons for icon-only buttons; colour follows the text (currentColor).
const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const MaximizeIcon = () => <svg {...props}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>;
export const RestoreIcon = () => <svg {...props}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>;
export const PanelIcon = () => <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>;
export const FastForwardIcon = () => <svg {...props}><path d="m3 5 8 7-8 7Zm10 0 8 7-8 7Z" /></svg>;
export const CrownIcon = () => <svg {...props}><path d="M3 18h18M4 15 3 7l5 4 4-6 4 6 5-4-1 8z" /></svg>;
export const ArtIcon = () => <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></svg>;
export const SearchIcon = () => <svg {...props}><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>;
export const StarIcon = () => <svg {...props}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>;
export const ShuffleIcon = () => <svg {...props}><path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 5-5m2-2c2-3 3-5 5-5h3m-4-4 4 4-4 4" /></svg>;
export const CheckIcon = () => <svg {...props}><path d="m5 12 4 4L19 6" /></svg>;
