export function SiteFooter() {
  return (
    <footer className="app-footer mt-auto border-t border-border/50 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 text-sm text-muted-foreground sm:px-6 sm:flex-row sm:items-center sm:justify-between">
        <p>MTG Central - decks stay in this browser unless you export them.</p>
        <p className="text-xs">
          Installable PWA · Cardmarket EUR via Scryfall · Scryfall art · no cloud sync
        </p>
      </div>
    </footer>
  );
}
