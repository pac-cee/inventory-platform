"use client";
import { useState } from "react";
import {
  Search,
  Box,
  ChevronRight,
  MapPin,
  Route,
  ArrowRight,
  SlidersHorizontal,
} from "lucide-react";
import type { SpatialItem, SpatialShelf } from "@/lib/spatial/model";
import type { FloorRoute } from "@/lib/spatial/directions";
export function InventoryExplorer({
  catalog,
  shelves,
  onChoose,
  onManage,
}: {
  catalog: SpatialItem[];
  shelves: SpatialShelf[];
  onChoose: (id: string, box?: string) => void;
  onManage?: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = catalog.filter((i) =>
    `${i.name} ${i.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="spatial-explore-intro">
        <p>Find an item. Open its box on the map.</p>
        {onManage && (
          <button onClick={onManage} className="spatial-button">
            <SlidersHorizontal />
            Manage catalog
          </button>
        )}
      </div>
      <label className="spatial-list-search">
        <Search size={16} />
        <input
          aria-label="Find inventory item"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or item type…"
        />
      </label>
      <div className="spatial-explore-list">
        {shown.slice(0, 100).map((item) => {
          const places = shelves.flatMap((s) =>
            (s.boxes ?? [])
              .filter((b) => b.items.some((i) => i.id === item.id))
              .map((b) => ({
                s,
                b,
                quantity: b.items
                  .filter((i) => i.id === item.id)
                  .reduce((n, i) => n + i.quantity, 0),
              })),
          );
          return (
            <article key={item.id}>
              <div className="spatial-explore-title">
                <Box size={18} />
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.type}</small>
                </div>
                <span>{places.reduce((n, p) => n + p.quantity, 0)}</span>
              </div>
              {places.length ? (
                places.map((p) => (
                  <button
                    key={`${p.s.id}:${p.b.id}`}
                    className="spatial-place-link"
                    onClick={() => onChoose(p.s.id, p.b.id)}
                  >
                    <MapPin size={13} />
                    <span>
                      {p.s.name} · {p.b.name}
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <p className="spatial-empty-placement">
                  Not placed on this floor
                </p>
              )}
            </article>
          );
        })}
        {!shown.length && (
          <p className="spatial-edit-hint">No items match that name.</p>
        )}
        {shown.length > 100 && (
          <p className="spatial-edit-hint">
            Refine your search to see more results.
          </p>
        )}
      </div>
    </>
  );
}
export function LocationsExplorer({
  shelves,
  onChoose,
  onManage,
}: {
  shelves: SpatialShelf[];
  onChoose: (id: string) => void;
  onManage?: () => void;
}) {
  return (
    <>
      <div className="spatial-explore-intro">
        <p>Choose a shelf to see its boxes.</p>
        {onManage && (
          <button onClick={onManage} className="spatial-button">
            Manage locations
          </button>
        )}
      </div>
      <div className="spatial-explore-list">
        {shelves.map((s) => (
          <button
            key={s.id}
            className="spatial-location-row"
            onClick={() => onChoose(s.id)}
          >
            <MapPin size={19} />
            <span>
              <strong>{s.name}</strong>
              <small>
                {s.boxes?.length ?? 0} boxes ·{" "}
                {s.items.reduce((n, i) => n + i.quantity, 0)} units
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </>
  );
}
export function DirectionsPanel({
  shelves,
  target,
  route,
  disabled,
  onRoute,
  onClear,
  boxLabel,
}: {
  boxLabel?: string;
  shelves: SpatialShelf[];
  target: string | null;
  route: FloorRoute | null;
  disabled: boolean;
  onRoute: (id: string) => void;
  onClear: () => void;
}) {
  const [destination, setDestination] = useState(
    target ?? shelves[0]?.id ?? "",
  );
  const shelf = shelves.find((s) => s.id === target);
  return (
    <div className="spatial-directions">
      {!route && (
        <p className="spatial-edit-hint">
          Choose a shelf to find your way from the entrance.
        </p>
      )}
      <div className="spatial-route-start">
        <MapPin size={18} />
        <div>
          <small>Start</small>
          <strong>Office entrance</strong>
        </div>
      </div>
      <form
        className="spatial-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          onRoute(destination);
        }}
      >
        <label>
          Destination shelf
          <select
            aria-label="Destination shelf"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {(!target || destination !== target) && (
          <button className="spatial-save" disabled={disabled || !destination}>
            <Route size={16} />
            Show directions
          </button>
        )}
      </form>
      {disabled ? (
        <p className="spatial-edit-hint">
          Directions need mapped walkways. Remove the imported plan to try the
          sample office route.
        </p>
      ) : target && route ? (
        <div className="spatial-route-summary">
          <strong>About {route.distance.toFixed(0)} m</strong>
          <p>
            Office entrance <ArrowRight size={13} /> {shelf?.name}
          </p>
          <ol>
            <li>Start at the pink entrance marker.</li>
            <li>Follow the floor line around the furniture.</li>
            <li>
              Stop in front of {shelf?.name}
              {boxLabel ? ` and find “${boxLabel}”` : ""}.
            </li>
          </ol>
          <button className="spatial-button" onClick={onClear}>
            Clear route
          </button>
        </div>
      ) : target ? (
        <p role="alert" className="spatial-edit-hint">
          No clear route to this shelf. Move it away from furniture in Edit
          plan.
        </p>
      ) : null}
      <p className="spatial-local-note">
        Sample floor directions. The start point is the entrance, not your live
        position.
      </p>
    </div>
  );
}
