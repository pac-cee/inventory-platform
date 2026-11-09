import { expect, it } from "vitest";
import { framingDistance, clampZoomDistance, followObject } from "./camera";
it("can frame a single small box closer than the old seven metre cap", () => {
  expect(framingDistance(0.55, 42, 1)).toBeLessThan(2);
  expect(clampZoomDistance(1.5)).toBe(1.5);
});
it("keeps a box inside narrow phone viewports", () => {
  expect(framingDistance(0.55, 42, 0.5)).toBeGreaterThan(
    framingDistance(0.55, 42, 1.5),
  );
});
it("keeps zoom outside geometry and inside the far view limit", () => {
  expect(clampZoomDistance(0.01)).toBe(0.45);
  expect(clampZoomDistance(500)).toBe(80);
});
it("keeps the same eye position relative to a rotated and moved shelf", () => {
  const p = followObject(
    [0, 2, 4],
    { position: [0, 0, 0], yaw: 0 },
    { position: [3, 0, 1], yaw: Math.PI / 2 },
  );
  expect(p[0]).toBeCloseTo(7);
  expect(p[1]).toBeCloseTo(2);
  expect(p[2]).toBeCloseTo(1);
});
it("follows a box when its level changes", () => {
  expect(
    followObject(
      [1, 1, 4],
      { position: [1, 0, 0], yaw: 0 },
      { position: [1, 2, 0], yaw: 0 },
    ),
  ).toEqual([1, 3, 4]);
});
