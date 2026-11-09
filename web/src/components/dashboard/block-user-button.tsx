"use client";

import { useState, useTransition } from "react";
import { Ban, CircleCheck } from "lucide-react";
import { setBlocked } from "@/app/(app)/admin/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Block, unblock — and approve.
 *
 * An account that registered itself arrives blocked and waiting, so unblocking
 * one is the approval: same button, and no way to approve an account while
 * leaving it unable to sign in. The wording changes so the admin knows which of
 * the two they are doing, and that approving sends the person an email.
 */
export function BlockUserButton({
  id,
  name,
  blocked,
  awaitingApproval = false,
}: {
  id: string;
  name: string;
  blocked: boolean;
  awaitingApproval?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const verb = awaitingApproval ? "Approve" : blocked ? "Unblock" : "Block";

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await setBlocked(id, !blocked);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not ${verb.toLowerCase()} user.`);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`${verb} ${name}`}
        title={awaitingApproval ? "Approve this account" : blocked ? "Unblock user" : "Block user"}
        className={
          "inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-highlight/25 " +
          (blocked
            ? "hover:bg-emerald-500/10 hover:text-emerald-400"
            : "hover:bg-amber-500/10 hover:text-amber-400")
        }
      >
        {blocked ? <CircleCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${verb} ${name}?`}
        description={
          awaitingApproval
            ? "They will be emailed that they can sign in."
            : blocked
              ? "They will be able to sign in again."
              : "They will no longer be able to sign in. Nothing is deleted."
        }
        confirmLabel={verb}
        pending={pending}
        error={error}
        onConfirm={onConfirm}
      />
    </>
  );
}
