import { aggregateProgress, MAX_PARTS, MIN_PART_BYTES, partRangeHeader, partSize, planParts } from "@/services/downloads/partPlan";

describe("planParts", () => {
  it("covers the file exactly, with inclusive contiguous ranges", () => {
    const total = 561_758_112;
    const parts = planParts(total);
    expect(parts[0].start).toBe(0);
    expect(parts[parts.length - 1].end).toBe(total - 1);
    for (let i = 1; i < parts.length; i += 1) expect(parts[i].start).toBe(parts[i - 1].end + 1);
    expect(parts.reduce((sum, part) => sum + partSize(part), 0)).toBe(total);
  });

  it("caps at MAX_PARTS for large files", () => {
    expect(planParts(MIN_PART_BYTES * 100)).toHaveLength(MAX_PARTS);
  });

  it("stays single below twice the minimum part size", () => {
    expect(planParts(MIN_PART_BYTES * 2 - 1)).toHaveLength(1);
    expect(planParts(MIN_PART_BYTES * 2)).toHaveLength(2);
  });

  it("answers one open-ended part for an unknown size", () => {
    expect(planParts(0)).toEqual([{ index: 0, start: 0, end: -1 }]);
    expect(planParts(Number.NaN)).toEqual([{ index: 0, start: 0, end: -1 }]);
  });
});

describe("partRangeHeader", () => {
  it("writes an inclusive bytes range", () => {
    expect(partRangeHeader({ index: 1, start: 100, end: 199 })).toEqual({ Range: "bytes=100-199" });
  });

  it("sends no Range for an open-ended part", () => {
    expect(partRangeHeader({ index: 0, start: 0, end: -1 })).toEqual({});
  });
});

describe("aggregateProgress", () => {
  it("sums per-part writes and clamps a part to its own span", () => {
    const parts = planParts(MIN_PART_BYTES * 2);
    const half = partSize(parts[0]) / 2;
    const written = new Map([
      [0, half],
      [1, partSize(parts[1]) + 5_000],
    ]);
    expect(aggregateProgress(parts, written)).toBe(half + partSize(parts[1]));
  });
});
