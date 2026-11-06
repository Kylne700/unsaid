/** Public Unsaid pages (home and room links). Every other route keeps the scaffold's sign-in. */
export function isUnsaidPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/r" || pathname.startsWith("/r/");
}
