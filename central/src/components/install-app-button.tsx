"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "mtg-central-install-dismissed:v1";

function isIosSafari() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const notChrome = !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && notChrome;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function wasDismissed() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosOpen, setIosOpen] = useState(false);
  // Start hidden so the server render matches the first client render.
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [readyHint, setReadyHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      setHidden(true);
      return;
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (!wasDismissed()) setHidden(false);
    };

    const onInstalled = () => {
      setHidden(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    const t = window.setTimeout(() => {
      if (!isStandalone() && !wasDismissed()) {
        setReadyHint(true);
        setHidden(false);
      }
    }, 1800);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  if (installed || hidden) return null;

  const onInstall = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome !== "accepted") {
          window.localStorage.setItem(DISMISS_KEY, "1");
        }
      } catch {
        setIosOpen(true);
        return;
      }
      setHidden(true);
      setDeferred(null);
      return;
    }
    setIosOpen(true);
  };

  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        className={compact ? "text-primary" : "gap-1.5 border-primary/35 text-primary"}
        onClick={onInstall}
        aria-label="Install MTG Central app"
        title={readyHint || deferred ? "Install app" : "Install app"}
      >
        <Download className="size-4" />
        {!compact && <span>Install app</span>}
      </Button>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install MTG Central</DialogTitle>
            <DialogDescription>
              Add the app to your home screen for a full-screen, installable experience.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            {isIosSafari() ? (
              <ol className="list-decimal space-y-2 pl-4">
                <li className="flex flex-wrap items-center gap-1">
                  Tap <Share className="inline size-4 text-primary" aria-hidden /> Share in Safari
                </li>
                <li>
                  Choose <span className="font-medium text-foreground">Add to Home Screen</span>
                </li>
                <li>
                  Confirm the name <span className="font-medium text-foreground">MTG Central</span>
                </li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-2 pl-4">
                <li>Open the browser menu (⋮ or ⋯)</li>
                <li>
                  Choose <span className="font-medium text-foreground">Install app</span> or{" "}
                  <span className="font-medium text-foreground">Install MTG Central</span>
                </li>
                <li>
                  Or use the install icon in the address bar when your browser offers it.
                </li>
              </ol>
            )}
            <p className="text-xs">
              iOS uses Add to Home Screen (no automatic install banner). Your decks stay in this
              browser&apos;s storage either way.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                window.localStorage.setItem(DISMISS_KEY, "1");
                setIosOpen(false);
                setHidden(true);
              }}
            >
              Not now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
