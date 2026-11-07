// The page shown when a route cannot be shown: an address that does not exist, or something that threw. Plain words, no status number
// and nothing taken from the error itself (its text can hold a stack, a path or a secret).
import { appPath } from "@agent-native/core/client/api-path";
import { isDynamicImportFailureMessage, recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";
import { useEffect, useState } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";

import { Button } from "@/components/ui/button";
import { FRIENDLY } from "@/lib/friendly-error";

export type ErrorKind = "notfound" | "stale" | "other";

export function errorKind(error: unknown): ErrorKind {
  if (isRouteErrorResponse(error)) return error.status === 404 ? "notfound" : "other";
  return error instanceof Error && isDynamicImportFailureMessage(error.message) ? "stale" : "other";
}

export function ErrorScreen({ kind }: { kind: "notfound" | "other" }) {
  const notFound = kind === "notfound";
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <title>{notFound ? "Page not found - Unsaid" : "Something went wrong - Unsaid"}</title>
      <div className="mx-auto max-w-lg" role={notFound ? undefined : "alert"}>
        <h1 className="text-xl font-semibold">{notFound ? "We could not find that page" : "We could not show this page"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{notFound ? "The link may be old or mistyped." : FRIENDLY.server}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {notFound ? null : (
            <Button type="button" onClick={() => window.location.reload()}>
              Try again
            </Button>
          )}
          <Button asChild variant={notFound ? "default" : "outline"}>
            <a href={appPath("/")}>Back to the start</a>
          </Button>
        </div>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const kind = errorKind(error);
  // A tab that stayed open across a new deploy cannot fetch the old script files: one reload fetches the new ones (the framework
  // allows that once per minute). Offline, a reload only shows the browser's offline page, so it is not tried.
  const [recovering, setRecovering] = useState(kind === "stale");
  useEffect(() => {
    if (kind === "stale") {
      if (!navigator.onLine || !recoverFromStaleChunkError(error)) setRecovering(false);
    } else if (kind === "other") console.error("[unsaid] page error", error);
  }, [kind, error]);
  if (kind === "stale" && recovering) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <p role="status" className="mx-auto max-w-lg text-sm text-muted-foreground">
          Loading the latest version...
        </p>
      </main>
    );
  }
  return <ErrorScreen kind={kind === "notfound" ? "notfound" : "other"} />;
}
