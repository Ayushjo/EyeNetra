import { describe, expect, it } from "vitest";
import { PersonSwitchDetector } from "./personSwitch";

const m = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

describe("PersonSwitchDetector", () => {
  it("ignores normal head motion, flags a jump to another face", () => {
    const d = new PersonSwitchDetector();
    expect(d.update(m(0, 0, -45))).toBe(false);
    expect(d.update(m(1.5, 0.5, -44))).toBe(false);
    expect(d.update(m(18, -3, -60))).toBe(true);
    expect(d.update(m(18.5, -3, -60))).toBe(false);
  });
});
