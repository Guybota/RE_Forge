import { cn } from "@/lib/utils";

/** Official Commander Format Panel Game Changer mark. */
export function GameChangerBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-max items-center whitespace-nowrap rounded-md bg-black/90 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary ring-1 ring-primary/50",
        className,
      )}
    >
      Game Changer
    </span>
  );
}
