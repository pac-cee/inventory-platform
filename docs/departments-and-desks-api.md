# Departments and desks: what the API needs

The UI runs on the built-in mock (`src/lib/api/mock`) today. For the real
inventory-api to back these two features it needs the endpoints below. Until it
has them, the app hides the features: the Items page shows no departments and
desks on the office map stay fixed.

## Departments

Items belong to at most one department. Admins and stock managers manage the list.

| Call | Body | Returns |
|---|---|---|
| `GET /departments` | | `[{ id, name, color, created_at }]` |
| `POST /departments` | `{ name, color }` | the department; 409 if the name is taken (case-insensitive) |
| `PATCH /departments/:id` | `{ name?, color? }` | the department |
| `DELETE /departments/:id` | | `{ cleared }`; its items get `department_id = null` |

`items` gains `department_id uuid null references departments(id) on delete set null`,
accepted by `POST /items` and `PATCH /items/:id` and returned on every item.

## Floor plan and desks

The room is one JSON document, edited in the office map (Edit plan > Room):
its size, door, every piece of furniture, and where each shelf stands. Its
shape is `FloorPlan` in `src/lib/spatial/verlet-site.ts`. The mock keeps it in
`data/floor-plan.json`, so a room laid out by hand survives a restart; commit
that file to make it the room everyone starts from.

| Call | Body | Returns |
|---|---|---|
| `GET /floor-plan` | | the saved plan, or `null` when nobody has saved one |
| `PUT /floor-plan` | a `FloorPlan` | the plan |
| `DELETE /floor-plan` | | `null`; the app's default room is used again |
| `GET /desks` | | `[{ id, user_id }]`: who sits at which desk |
| `PUT /desks/:id` | `{ user_id }` | the desk (created if missing) |

Desk ids are the ids of the plan's pieces of kind `workstation`.

Rules the API should enforce (the app's server actions already do): only an
admin or stock manager may `PUT`/`DELETE` the plan or set a desk's `user_id`.
The one exception is a person moving their own desk, which the app does by
rewriting that one piece's `x`, `z`, `rot` in the plan on their behalf.
