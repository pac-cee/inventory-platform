"use client";

import { useTransition, useState } from "react";
import { CreditCard, BarChart3 } from "lucide-react";
import { RoleSelect } from "@/components/dashboard/role-select";
import { DeleteUserButton } from "@/components/dashboard/delete-user-button";
import { BlockUserButton } from "@/components/dashboard/block-user-button";
import { EditUserButton } from "@/components/dashboard/edit-user-button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UserReportDialog } from "@/components/dashboard/user-report-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { changePaymentPermission } from "@/app/(app)/admin/actions";
import type { Profile } from "@/lib/api/types";

interface UsersTableClientProps {
  initialProfiles: Profile[];
  currentUserId: string;
}

export function UsersTableClient({
  initialProfiles,
  currentUserId,
}: UsersTableClientProps) {
  const [pending, startTransition] = useTransition();
  const [reportProfile, setReportProfile] = useState<Profile | null>(null);

  // Who the open payment-permission confirmation is about.
  const [permTarget, setPermTarget] = useState<{ id: string; name: string; allowed: boolean } | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  const confirmPermission = () => {
    if (!permTarget) return;
    setPermError(null);
    startTransition(async () => {
      try {
        await changePaymentPermission(permTarget.id, !permTarget.allowed);
        setPermTarget(null);
      } catch (err) {
        setPermError(err instanceof Error ? err.message : "Failed to update payment permission.");
      }
    });
  };

  return (
    <>
      <Table>
        <TableHeader>
        <TableRow>
          <TableHead className="px-5">Name</TableHead>
          <TableHead className="px-5">Role</TableHead>
          <TableHead className="px-5">Joined</TableHead>
          <TableHead className="px-5 text-center">Payment Permission</TableHead>
          <TableHead className="px-5 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {initialProfiles.map((p) => {
          const isAllowed = !!p.has_payment_permission;
          // Registered themselves and not yet let in. Blocked is true as well,
          // but "waiting" is the useful thing to say — nobody blocked them.
          const awaitingApproval = p.approval_status === "pending";
          // Whose move it is. Once they have confirmed the address, the only
          // thing left is this admin pressing approve; before that, the wait is
          // on them and approving early would let an unproven address in.
          const waitingOnAdmin = awaitingApproval && p.email_confirmed !== false;
          return (
            <TableRow key={p.id}>
              <TableCell className="px-5 font-medium text-foreground">
                <span className="inline-flex items-center gap-2">
                  {p.full_name || "—"}
                  {awaitingApproval ? (
                    <Badge
                      variant="chip"
                      className={
                        waitingOnAdmin
                          ? "bg-highlight-soft text-highlight border border-highlight/25"
                          : "bg-warning-soft text-amber-700 dark:text-warning border border-warning/25"
                      }
                      title={
                        waitingOnAdmin
                          ? "Email confirmed — approve to let them sign in"
                          : "They have not confirmed their email address yet"
                      }
                    >
                      {waitingOnAdmin ? "Approve to let them in" : "Awaiting their email"}
                    </Badge>
                  ) : p.blocked ? (
                    <Badge
                      variant="chip"
                      className="bg-warning-soft text-amber-700 dark:text-warning border border-warning/25"
                    >
                      Blocked
                    </Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="px-5">
                <RoleSelect id={p.id} role={p.role} isSelf={p.id === currentUserId} />
              </TableCell>
              <TableCell className="px-5 text-muted-foreground" suppressHydrationWarning>
                {new Date(p.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="px-5 text-center">
                {p.id === currentUserId ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPermError(null);
                      setPermTarget({ id: p.id, name: p.full_name || "this user", allowed: isAllowed });
                    }}
                    aria-label={
                      isAllowed
                        ? `Revoke payment permission for ${p.full_name || "this user"}`
                        : `Allow ${p.full_name || "this user"} to make payments`
                    }
                    title={isAllowed ? "Revoke payment permission" : "Allow to make payments"}
                    className={
                      "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25 " +
                      (isAllowed
                        ? "border-success/25 bg-success-soft text-emerald-700 hover:bg-emerald-500/20 dark:text-success"
                        : "border-border text-muted-foreground hover:bg-hover hover:text-foreground")
                    }
                  >
                    <CreditCard className="h-4 w-4" />
                    {isAllowed ? "Can pay" : "Off"}
                  </button>
                )}
              </TableCell>
              <TableCell className="px-5 text-right">
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setReportProfile(p)}
                    title="View spending report"
                    aria-label={`View spending report for ${p.full_name || "this user"}`}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-highlight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25"
                  >
                    <BarChart3 className="h-4 w-4" />
                  </button>
                  {p.id !== currentUserId && (
                    <>
                      <EditUserButton profile={p} />
                      <BlockUserButton
                        id={p.id}
                        name={p.full_name || "this user"}
                        blocked={p.blocked}
                        awaitingApproval={awaitingApproval}
                      />
                      <DeleteUserButton id={p.id} name={p.full_name || "this user"} />
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>

      <ConfirmDialog
        open={permTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPermTarget(null);
        }}
        title={
          permTarget?.allowed
            ? `Revoke payment permission for ${permTarget.name}?`
            : `Allow ${permTarget?.name ?? "this user"} to make payments?`
        }
        description={
          permTarget?.allowed
            ? "They will no longer be able to start payments."
            : "They will be able to start payments from the Payment screen."
        }
        confirmLabel={permTarget?.allowed ? "Revoke permission" : "Allow payments"}
        pending={pending}
        error={permError}
        onConfirm={confirmPermission}
      />

      {reportProfile && (
        <UserReportDialog
          isOpen={!!reportProfile}
          onClose={() => setReportProfile(null)}
          profile={reportProfile!}
        />
      )}
    </>
  );
}
