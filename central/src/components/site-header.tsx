"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { InstallAppButton } from "@/components/install-app-button";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/decks", label: "My Decks", short: "Decks" },
  { href: "/precons", label: "Precons", short: "Precons" },
  { href: "/compare", label: "Compare Decks", short: "Compare" },
  { href: "/improve", label: "Improve Decks", short: "Improve" },
  { href: "/sage", label: "Magic Sage", short: "Sage" },
  { href: "/play", label: "Play", short: "Play" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="app-chrome sticky top-0 z-40 border-b border-border/50 bg-[#070d18]/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/30 to-sky/20 text-primary shadow-inner ring-1 ring-primary/30 transition group-hover:from-primary/40">
            <Sparkles className="size-4" />
          </span>
          <span className="font-display truncate text-lg font-bold tracking-tight text-foreground">
            MTG Central
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/15 font-medium text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ml-2">
            <InstallAppButton />
          </div>
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          <InstallAppButton compact />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border/60 bg-[#0b1220] px-4 py-3 md:hidden">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block rounded-md px-3 py-2.5 text-sm",
                      active
                        ? "bg-primary/15 font-medium text-primary"
                        : "text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

/** Bottom tab bar for phone - always useful; stronger in standalone PWA */
export function AppTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="app-tabbar sticky bottom-0 z-40 border-t border-border/50 bg-[#070d18]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-6 gap-1 px-2 py-1.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center rounded-lg px-1 py-2 text-[10px] font-medium transition",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
