import { Suspense } from "react";
import { ImproveView } from "@/components/improve-view";

export default function ImprovePage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string | string[] }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
          Loading improve…
        </div>
      }
    >
      <ImproveRoute searchParams={searchParams} />
    </Suspense>
  );
}

async function ImproveRoute({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string | string[] }>;
}) {
  const { deck } = await searchParams;
  const initialDeckId = (Array.isArray(deck) ? deck[0] : deck) ?? "";
  return <ImproveView key={initialDeckId} initialDeckId={initialDeckId} />;
}
