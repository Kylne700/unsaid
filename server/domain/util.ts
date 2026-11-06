import { createHash, randomBytes, randomInt } from "node:crypto";
import type { OptionDef } from "./types";

export type ErrorKind = "not_found" | "forbidden" | "bad_phase" | "invalid" | "conflict";
const STATUS: Record<ErrorKind, number> = { not_found: 404, forbidden: 403, bad_phase: 409, invalid: 400, conflict: 409 };

/** The only error the domain throws on purpose; the action layer turns it into a caller-visible failure. */
export class RoomError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  constructor(message: string, kind: ErrorKind = "invalid") {
    super(message);
    this.kind = kind;
    this.status = STATUS[kind];
  }
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url")}`;
export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// No I, L, O, 0 or 1: codes are read aloud and typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Same seed, same order: the weigh list must not reshuffle on every poll. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hash32(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function optionNameRegex(options: OptionDef[]): RegExp | null {
  const names = options
    .flatMap((o) => [o.name, ...o.aliases])
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * The same fact with the option it is about called "this option" and any other option it names called
 * "another option" (so "Omega costs more than Zeta" stays readable). With no subject, the first option named is the subject.
 * shortcut: capitalises only at the start of the text or after . ! ? , not after a quote or bracket.
 */
export function neutralize(text: string, options: OptionDef[], subject?: string | null): string {
  const re = optionNameRegex(options);
  if (!re) return text;
  const idOf = new Map(options.flatMap((o) => [o.name, ...o.aliases].map((n) => [n.trim().toLowerCase(), o.id] as const)));
  let about: string | null | undefined = subject;
  return text.replace(re, (name: string, at: number) => {
    const id = idOf.get(name.toLowerCase());
    about ??= id;
    const label = id === about ? "this option" : "another option";
    return /(^|[.!?]\s+)$/.test(text.slice(0, at)) ? label.charAt(0).toUpperCase() + label.slice(1) : label;
  });
}

/** Which options a text names (by name or alias), as option ids. */
export function optionsNamed(text: string, options: OptionDef[]): string[] {
  return options.filter((o) => {
    const re = optionNameRegex([o]);
    return re ? re.test(text) : false;
  }).map((o) => o.id);
}
