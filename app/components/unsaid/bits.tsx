// Small pieces every phase uses: option tags, pro/con marks, "simulated" labels, names for lists of options.
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type OptionLite = { id: string; name: string };

/** One column per option from `sm` up, one column on a phone (a third of 375 px holds about 12 characters). Pair with `optionColumns(n)`. */
export const OPTION_COLUMNS = "grid grid-cols-1 sm:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]";
export const optionColumns = (n: number) => ({ "--n": n }) as CSSProperties;

// One neutral tag for every option: its name is in the tag, and amber, emerald and rose are kept for "only one knew", Pro and Con.
const OPTION_TAG = "border-border bg-muted text-foreground";

export const nameOfOption = (options: OptionLite[], id: string | null | undefined) => options.find((o) => o.id === id)?.name ?? "?";

/** "A", "A and B", "A, B and C" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function Tag({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4", className)}>{children}</span>;
}

export function OptionTag({ options, id }: { options: OptionLite[]; id: string }) {
  return <Tag className={OPTION_TAG}>{nameOfOption(options, id)}</Tag>;
}

export function PolarityMark({ polarity }: { polarity: "pro" | "con" }) {
  return (
    <Tag className={polarity === "pro" ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-300" : "border-rose-600/30 text-rose-700 dark:text-rose-300"}>
      {polarity === "pro" ? "Pro" : "Con"}
    </Tag>
  );
}

/** "Ben (you)" for the viewer; the practice player is already called "You", so no second "(you)". */
export const meName = (name: string) => (/^you$/i.test(name.trim()) ? name : `${name} (you)`);

/** Who knew a card, without names (they come with the reveal): "you", "you and 2 others", "1 person", "3 people". */
export function knownBy(mine: boolean, count: number): string {
  const others = count - (mine ? 1 : 0);
  if (mine) return others === 0 ? "you" : `you and ${others} other${others === 1 ? "" : "s"}`;
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/** A name, with a "simulated" label when it is a scripted teammate. */
export function Who({ name, simulated, className }: { name: string; simulated?: boolean | undefined; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span>{name}</span>
      {simulated ? <span className="rounded bg-muted px-1 py-px text-xs font-medium uppercase tracking-wide text-muted-foreground">simulated</span> : null}
    </span>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm";

export const errorText = "text-red-700 dark:text-red-300";
