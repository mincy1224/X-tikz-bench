import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import {
  rewriteOptionListMutations,
  serializeOptionEntry
} from "../packages/core/src/edit/option-mutations.js";

describe("option mutation serialization", () => {
  it("preserves non-bracketed option sites when all entries are removed", () => {
    const mutations = new Map([["draw", { kind: "remove" } as const]]);

    expect(rewriteOptionListMutations(parseOptionListRaw("[draw]"), mutations, undefined, "braced")).toBe("{}");
    expect(rewriteOptionListMutations(parseOptionListRaw("[draw]"), mutations, undefined, "bare")).toBe("");
  });

  it("can remove the no-arrow shorthand flag", () => {
    const mutations = new Map([["-", { kind: "remove" } as const]]);

    expect(rewriteOptionListMutations(parseOptionListRaw("[red, -]"), mutations)).toBe("[red]");
  });

  it("writes exact RGB as an explicit path color", () => {
    const drawContext = { bareColorKey: "draw" as const };

    expect(serializeOptionEntry("draw", "{rgb,255:red,1;green,2;blue,3}", drawContext)).toBe(
      "draw={rgb,255:red,1;green,2;blue,3}"
    );
    expect(serializeOptionEntry("draw", "red!30!blue", drawContext)).toBe("red!30!blue");
    expect(serializeOptionEntry("draw", "not a color expression", drawContext)).toBe(
      "draw=not a color expression"
    );
  });

  it("replaces a legacy bare RGB option instead of leaving it alongside the new color", () => {
    const options = parseOptionListRaw("[opacity=.5,{rgb,255:red,161;green,161;blue,161}]");
    expect(rewriteOptionListMutations(options, new Map([["fill", { kind: "set", value: "red" }]]), { bareColorKey: "fill" }))
      .toBe("[opacity=.5, red]");
  });
});
