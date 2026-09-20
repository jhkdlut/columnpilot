import { describe, expect, it } from "vitest";
import { getPaginationWindow } from "./pagination";

describe("getPaginationWindow", () => {
  it("returns an empty first page for an empty result", () => {
    expect(getPaginationWindow(0, 0, 25)).toEqual({
      pageIndex: 0,
      pageCount: 1,
      pageSize: 25,
      start: 0,
      end: 0,
      total: 0,
    });
  });

  it("calculates a partial final page", () => {
    expect(getPaginationWindow(63, 2, 25)).toMatchObject({
      pageIndex: 2,
      pageCount: 3,
      start: 50,
      end: 63,
    });
  });

  it("clamps an out-of-range page after results shrink", () => {
    expect(getPaginationWindow(12, 9, 25)).toMatchObject({
      pageIndex: 0,
      pageCount: 1,
      start: 0,
      end: 12,
    });
  });

  it("normalizes invalid values", () => {
    expect(getPaginationWindow(Number.NaN, -3, 0)).toMatchObject({
      pageIndex: 0,
      pageCount: 1,
      pageSize: 1,
      total: 0,
    });
  });
});
