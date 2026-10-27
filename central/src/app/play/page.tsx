import { Suspense } from "react";
import { PlayView } from "@/components/play-view";

export default function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string | string[] }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
          RE:Forge
        </div>
      }
    >
      <PlayRoute searchParams={searchParams} />
    </Suspense>
  );
}

async function PlayRoute({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string | string[] }>;
}) {
  const { deck } = await searchParams;
  const initialDeckId = (Array.isArray(deck) ? deck[0] : deck) ?? "";
  return <PlayView key={initialDeckId} initialDeckId={initialDeckId} />;
}
