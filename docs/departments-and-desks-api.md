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

## Desks

One row per desk someone has moved or been given. Ids are the floor plan's
(`src/lib/spatial/verlet-site.ts`, `DESKS`), e.g. `soft-workstation-3`.

| Call | Body | Returns |
|---|---|---|
| `GET /desks` | | `[{ id, user_id, x, z, rotation }]` |
| `PUT /desks/:id` | `{ x?, z?, rotation?, user_id? }` | the desk (created if missing) |

Rules the API should enforce (the app's server action already does):
a person may change `x`, `z`, `rotation` of a desk whose `user_id` is theirs;
only an admin or stock manager may change any desk or set `user_id`.
`x`/`z` are metres from the hall's centre, `rotation` is 0, 90, 180 or 270.
