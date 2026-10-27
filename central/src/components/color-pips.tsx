import type { ColorIdentity } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS: Record<ColorIdentity, { label: string; className: string }> = {
  W: { label: "White", className: "bg-[#f0ead8] text-[#1a1a1a] border-[#c9c0a8]" },
  U: { label: "Blue", className: "bg-[#0e68ab] text-white border-[#0a4f82]" },
  B: { label: "Black", className: "bg-[#150b00] text-[#ccc] border-[#3a2a1a]" },
  R: { label: "Red", className: "bg-[#d3202a] text-white border-[#9a1820]" },
  G: { label: "Green", className: "bg-[#00733e] text-white border-[#00552e]" },
};

export function ColorPips({ colors }: { colors?: ColorIdentity[] }) {
  if (!colors?.length) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Colors: ${colors.join(", ")}`}>
      {colors.map((c) => (
        <span
          key={c}
          title={COLORS[c].label}
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-full border text-[9px] font-bold",
            COLORS[c].className,
          )}
        >
          {c}
        </span>
      ))}
    </span>
  );
}
