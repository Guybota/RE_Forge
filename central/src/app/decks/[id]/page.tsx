import { Suspense } from "react";
import { DeckDetailPage } from "@/components/deck-detail-dialog";

export default function DeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
          Restoring deck…
        </div>
      }
    >
      <DeckRoute params={params} />
    </Suspense>
  );
}

async function DeckRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckDetailPage deckId={id} />;
}
