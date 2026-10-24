// Small line icons for icon-only buttons; colour follows the text (currentColor).
const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const MaximizeIcon = () => <svg {...props}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>;
export const RestoreIcon = () => <svg {...props}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>;
export const PanelIcon = () => <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>;
