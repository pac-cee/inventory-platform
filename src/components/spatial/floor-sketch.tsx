import {
  AREA,
  COLUMNS,
  DOOR,
  OFFICES,
} from "@/lib/spatial/verlet-site";
import type { SpatialShelf } from "@/lib/spatial/model";

/**
 * A line drawing of Verlet's floor, shown while the 3D map loads: the hall,
 * the small offices and corridor, the door, the columns and every shelf at
 * its real position draw themselves in, so there is a map from the first
 * moment instead of a spinner.
 */
export function FloorSketch({ shelves }: { shelves: SpatialShelf[] }) {
  const pad = 1.5;
  const x0 = AREA.x0 - pad, z0 = OFFICES.z0 - pad;
  const w = AREA.x1 - AREA.x0 + pad * 2, h = AREA.z1 - OFFICES.z0 + pad * 2;
  const front = OFFICES.z1 - OFFICES.corridor;
  let i = 0;
  const step = () => ({ "--i": i++ }) as React.CSSProperties;
  return (
    <svg
      className="floor-sketch"
      viewBox={`${x0} ${z0} ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* hall and offices outline, with the door gap in the north wall */}
      <path
        pathLength={1}
        style={step()}
        d={`M ${DOOR.x - DOOR.w / 2} ${AREA.z0} H ${AREA.x0} V ${AREA.z1} H ${AREA.x1} V ${OFFICES.z0} H ${AREA.x0} V ${AREA.z0} M ${DOOR.x + DOOR.w / 2} ${AREA.z0} H ${AREA.x1}`}
      />
      <path pathLength={1} style={step()} d={`M ${AREA.x0} ${front} H ${AREA.x1}`} />
      {OFFICES.rooms.slice(1, -1).map((x) => (
        <path key={x} pathLength={1} style={step()} d={`M ${x} ${OFFICES.z0} V ${front}`} />
      ))}
      {COLUMNS.map(([x, z]) => (
        <rect key={`${x},${z}`} className="floor-sketch-column" x={x - 0.25} y={z - 0.25} width={0.5} height={0.5} style={step()} />
      ))}
      {shelves.map((s) => {
        const table = s.kind === "table";
        const sw = 2, sd = table ? 1 : 0.5;
        return (
          <rect
            key={s.id}
            className={table ? "floor-sketch-table" : "floor-sketch-shelf"}
            x={-sw / 2}
            y={-sd / 2}
            width={sw}
            height={sd}
            transform={`translate(${s.x} ${s.z}) rotate(${-s.rotation})`}
            style={step()}
          />
        );
      })}
      <circle className="floor-sketch-door" cx={DOOR.x} cy={AREA.z0 + 1} r={0.45} style={step()} />
    </svg>
  );
}
