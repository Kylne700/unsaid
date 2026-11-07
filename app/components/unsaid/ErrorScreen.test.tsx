import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FRIENDLY } from "@/lib/friendly-error";

import { ErrorScreen, errorKind } from "./ErrorScreen";

// The shape React Router gives a route error that came from a response (what an unknown address produces).
const response = (status: number) => ({ status, statusText: "x", internal: true, data: null });

describe("errorKind", () => {
  it("an address that does not exist is notfound; every other status and a thrown error is other", () => {
    expect(errorKind(response(404))).toBe("notfound");
    expect(errorKind(response(500))).toBe("other");
    expect(errorKind(new Error("boom"))).toBe("other");
    expect(errorKind(undefined)).toBe("other");
  });
  it("a script file that cannot be fetched (an old tab after a new deploy) is stale", () => {
    expect(errorKind(new Error("Failed to fetch dynamically imported module: /assets/x.js"))).toBe("stale");
  });
});

describe("ErrorScreen", () => {
  it("not found: plain words, no status number, a way back", () => {
    const html = renderToString(<ErrorScreen kind="notfound" />);
    expect(html).toContain("We could not find that page");
    expect(html).not.toMatch(/404/);
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Try again");
  });
  it("any other failure: the one fixed sentence, a retry and a way back, nothing from the error", () => {
    const html = renderToString(<ErrorScreen kind="other" />);
    expect(html).toContain(FRIENDLY.server);
    expect(html).toContain("Try again");
    expect(html).toContain("Back to the start");
    expect(html).toContain('role="alert"');
  });
});
