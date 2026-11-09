import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { serverApi, ApiError } from "@/lib/api/server";
import { Panel } from "@/components/dashboard/widgets";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { EditProfileForm } from "@/components/dashboard/edit-profile-form";
import { ChangePasswordForm } from "@/components/dashboard/change-password-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { signOut } from "@/app/(auth)/actions";
import type { ApiUser, Profile } from "@/lib/api/types";
import { roleLabel } from "@/lib/roles";

export default async function SettingsPage() {
  const api = serverApi();

  let user: ApiUser;
  let profile: Profile | null = null;
  try {
    const me = await api.get<{ user: ApiUser; profile: Profile | null }>("/auth/me");
    user = me.user;
    profile = me.profile;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/session-ended");
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-[1.75rem] text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your appearance and account.</p>
      </div>

      <Tabs defaultValue="profile" className="gap-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Panel title="Profile">
            <EditProfileForm fullName={profile?.full_name ?? ""} email={user.email ?? ""} />
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <span className="text-sm text-muted-foreground">Role</span>
              <Badge
                variant="chip"
                className={
                  profile?.role === "admin" || profile?.role === "stock_manager"
                    ? "bg-highlight-soft text-highlight"
                    : undefined
                }
              >
                {roleLabel(profile?.role)}
              </Badge>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="password">
          <Panel title="Password">
            <ChangePasswordForm />
          </Panel>
        </TabsContent>

        <TabsContent value="appearance">
          <Panel title="Appearance">
            <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Theme</p>
                <p className="text-sm text-muted-foreground">Choose light, dark, or follow your system.</p>
              </div>
              <ThemeToggle />
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="account">
          <Panel title="Account">
            <div className="flex items-center justify-between px-5 py-5">
              <div>
                <p className="text-sm font-medium text-foreground">Sign out</p>
                <p className="text-sm text-muted-foreground">End your session on this device.</p>
              </div>
              <form action={signOut}>
                <Button type="submit" variant="outline">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              </form>
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
