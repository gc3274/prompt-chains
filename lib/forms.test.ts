import { describe, expect, it } from "vitest";
import {
  constraintField,
  isStillReferenced,
  lengthOk,
  parseId,
  readDecimal,
  readPrompt,
  readText,
  readTopicOrAll,
  readWhole,
} from "./forms";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe("readText", () => {
  it("collapses whitespace and reads a missing field as empty", () => {
    expect(readText(form({ a: "  two\n\nlines  " }), "a")).toBe("two lines");
    expect(readText(form({}), "a")).toBe("");
  });
});

describe("lengthOk", () => {
  it("counts code points like char_length", () => {
    expect(lengthOk("🔥🔥", 1, 2)).toBe(true);
    expect(lengthOk("🔥🔥🔥", 1, 2)).toBe(false);
    expect(lengthOk("", 1, 2)).toBe(false);
  });
});

describe("readWhole", () => {
  it.each([
    ["0", 0],
    ["100", 100],
    ["101", null],
    ["-1", null],
    ["1.5", null],
    // What a number input sends for a whole number typed with a point
    ["5.0", 5],
    ["", null],
    ["1e2", null],
  ])("%j in 0..100 is %j", (raw, expected) => {
    expect(readWhole(form({ n: raw }), "n", 0, 100)).toBe(expected);
  });
});

describe("readTopicOrAll", () => {
  it("reads empty as every topic, a topic as itself and anything else as invalid", () => {
    expect(readTopicOrAll(form({ topic: "" }))).toBeNull();
    expect(readTopicOrAll(form({}))).toBeNull();
    expect(readTopicOrAll(form({ topic: "food" }))).toBe("food");
    expect(readTopicOrAll(form({ topic: "legacy" }))).toBeUndefined();
  });
});

describe("parseId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    [["7", "8"], 7],
    [3, 3],
    ["0", null],
    ["01", null],
    ["-1", null],
    ["1.0", null],
    ["99999999999999999", null],
    [undefined, null],
  ])("%j is %j", (raw, expected) => {
    expect(parseId(raw)).toBe(expected);
  });
});

describe("constraintField", () => {
  const map = { terms_term_lower_key: "term", terms_definition_len: "definition" } as const;

  it("maps a named unique or check violation to its field", () => {
    expect(
      constraintField({ code: "23505", message: 'duplicate key value violates unique constraint "terms_term_lower_key"' }, map),
    ).toBe("term");
    expect(
      constraintField({ code: "23514", message: 'new row for relation "terms" violates check constraint "terms_definition_len"' }, map),
    ).toBe("definition");
  });

  it("ignores other errors and unknown constraints", () => {
    expect(constraintField({ code: "23503", message: 'constraint "terms_term_lower_key"' }, map)).toBeNull();
    expect(constraintField({ code: "23514", message: 'violates check constraint "other"' }, map)).toBeNull();
    expect(constraintField(null, map)).toBeNull();
  });
});

describe("isStillReferenced", () => {
  it("is a foreign key violation", () => {
    expect(isStillReferenced({ code: "23503" })).toBe(true);
    expect(isStillReferenced({ code: "23505" })).toBe(false);
    expect(isStillReferenced(null)).toBe(false);
  });
});

describe("readPrompt", () => {
  const read = (v: string) => {
    const fd = new FormData();
    fd.set("p", v);
    return readPrompt(fd, "p");
  };

  it("keeps line breaks and inner spacing", () => {
    expect(read("Line one.\n\n  - a point\nLine three.")).toBe("Line one.\n\n  - a point\nLine three.");
  });

  it("turns Windows line endings into \\n and trims the ends", () => {
    expect(read("\r\n  Hi\r\nthere \r\n")).toBe("Hi\nthere");
  });

  it("reads only whitespace as empty", () => {
    expect(read(" \n\t ")).toBe("");
    expect(readPrompt(new FormData(), "p")).toBe("");
  });
});

describe("readDecimal", () => {
  const read = (v: string, places = 2, max = 2) => {
    const fd = new FormData();
    fd.set("n", v);
    return readDecimal(fd, "n", { min: 0, max, places });
  };

  it("reads numbers within the places and range", () => {
    expect(read("1")).toBe(1);
    expect(read("0.7")).toBe(0.7);
    expect(read("1.25")).toBe(1.25);
    expect(read(" 2 ")).toBe(2);
  });

  it("is null when blank", () => {
    expect(read("")).toBeNull();
    expect(read("   ")).toBeNull();
  });

  it("refuses more places than the column keeps, instead of rounding", () => {
    expect(read("1.555")).toBeUndefined();
    expect(read("0.1234", 4, 1000)).toBe(0.1234);
  });

  it("reads a leading point, as a number input sends it", () => {
    expect(read(".5")).toBe(0.5);
  });

  it.each(["2.01", "-1", "1e2", "abc", ".", "1.", "0x1", "1,5"])("refuses %s", (v) => {
    expect(read(v)).toBeUndefined();
  });
});
