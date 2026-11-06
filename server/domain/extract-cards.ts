import type { OptionDef, Polarity } from "./types";
import { neutralize, optionsNamed } from "./util";

/**
 * STAGE 1 STUB. This is the one place stage 2 replaces with LLM extraction.
 * It is plain text splitting, not AI: the action `extract-cards` awaits this function and
 * stores whatever it returns as the caller's private drafts, so a model-backed version only
 * has to keep this signature (it may be async).
 */
export interface ExtractedCard {
  text: string;
  /** Set only when the sentence names exactly one option; otherwise null and the owner picks. */
  option: string | null;
  /** Always null here: the stub cannot tell a pro from a con. */
  polarity: Polarity | null;
  /** text with every option name replaced by "this option". */
  neutral: string;
}

const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;

export function extractCards(notes: string, options: OptionDef[]): ExtractedCard[] {
  const out: ExtractedCard[] = [];
  for (const line of notes.split(/\r?\n/)) {
    for (const piece of line.replace(BULLET, "").split(/(?<=[.!?])\s+/)) {
      const text = piece.trim();
      if (text.length < 8 || text.length > 400) continue;
      const named = optionsNamed(text, options);
      out.push({
        text,
        option: named.length === 1 ? (named[0] as string) : null,
        polarity: null,
        neutral: neutralize(text, options),
      });
    }
  }
  return out;
}
