import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { serverApi, ApiError } from "@/lib/api/server";
import { Panel } from "@/components/dashboard/widgets";
import { UserPlus } from "lucide-react";
import { FormDialog } from "@/components/ui/form-dialog";
import { AddUserForm } from "@/components/dashboard/add-user-form";
import { UsersTableClient } from "@/components/dashboard/users-table-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ApiUser, Profile } from "@/lib/api/types";
import { isAdmin } from "@/lib/roles";

export default async function UsersPage() {
  const api = serverApi();

  // Admins only.
  let profile: Profile | null = null;
  let currentUserId = "";
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    profile = me.profile;
    currentUserId = me.user.id;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }
  // Running the place, not the warehouse — admin only.
  if (!isAdmin(profile)) redirect("/");

  let profiles: Profile[] = [];
  let loadError: string | null = null;
  try {
    // P4: read-only user list — cache 60s.
    profiles = await api.get<Profile[]>("/profiles", { revalidate: 60 });
  } catch (err) {
    loadError = err instanceof ApiError ? err.message : "Could not load users.";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.75rem] text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone with an account, and their access level.
          </p>
        </div>
        {/* Stays open after saving: its message says what to hand the new user. */}
        <FormDialog title="Add user" description="Create an account and choose their access level." triggerLabel="Add user" triggerIcon={<UserPlus />} size="md">
          <AddUserForm />
        </FormDialog>
      </div>

      {loadError ? (
        <Alert variant="warning">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <Panel
        title="Team members"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {profiles.length}
          </span>
        }
      >
        {profiles.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No users found.</p>
        ) : (
          <UsersTableClient initialProfiles={profiles} currentUserId={currentUserId} />
        )}
      </Panel>
    </div>
  );
}
