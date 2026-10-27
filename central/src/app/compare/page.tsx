import { Suspense } from "react";
import { CompareView } from "@/components/compare-view";

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground sm:px-6">
          Loading compare…
        </div>
      }
    >
      <CompareView />
    </Suspense>
  );
}
