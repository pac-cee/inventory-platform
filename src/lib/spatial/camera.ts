/** Distance needed to fit a bounding sphere inside both viewport dimensions. */
export function framingDistance(
  radius: number,
  verticalFov: number,
  aspect: number,
): number {
  const vertical = (verticalFov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.1, aspect));
  return clampZoomDistance(
    (radius / Math.sin(Math.min(vertical, horizontal))) * 1.12,
  );
}
export function clampZoomDistance(distance: number): number {
  return Math.max(0.45, Math.min(140, distance));
}
export interface ObjectPose {
  position: number[];
  yaw: number;
}
/** Preserve the observer's offset when an object moves or rotates around Y. */
export function followObject(
  point: number[],
  before: ObjectPose,
  after: ObjectPose,
): number[] {
  const x = point[0] - before.position[0],
    z = point[2] - before.position[2],
    angle = after.yaw - before.yaw;
  return [
    after.position[0] + x * Math.cos(angle) + z * Math.sin(angle),
    after.position[1] + point[1] - before.position[1],
    after.position[2] - x * Math.sin(angle) + z * Math.cos(angle),
  ];
}
