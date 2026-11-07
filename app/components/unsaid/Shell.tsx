import type { ReactNode } from "react";
import { Link } from "react-router";

/** Minimal public shell for Unsaid pages: no account chrome, one calm column. */
export function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="unsaid-shell min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Unsaid
          </Link>
          <div className="text-sm text-muted-foreground">{right}</div>
        </div>
      </header>
      {/* pb-20: Netlify's free-plan badge (fixed, bottom right, 64 px high) must never sit on the last control of a page. */}
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-4 sm:pt-8">{children}</main>
    </div>
  );
}
