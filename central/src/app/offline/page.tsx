import Link from "next/link";
import { WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <div className="panel-strong w-full p-8 sm:p-10">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <WifiOff className="size-7" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          You&apos;re offline
        </h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          MTG Central can&apos;t reach the network right now. Decks already saved in this
          browser still live in local storage - reconnect to load card art and open other
          pages.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className={cn(buttonVariants({ size: "lg" }))}>
            Try home again
          </Link>
          <Link href="/decks" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Open My Decks
          </Link>
        </div>
      </div>
    </div>
  );
}
