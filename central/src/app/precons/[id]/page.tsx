import { Suspense } from "react";
import { PreconDetail } from "@/components/precon-detail";

export default function PreconPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
          Opening precon…
        </div>
      }
    >
      <PreconRoute params={params} />
    </Suspense>
  );
}

async function PreconRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PreconDetail preconId={id} />;
}
