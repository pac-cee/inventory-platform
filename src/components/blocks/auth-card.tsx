import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VerletLogo } from "@/components/ui/verlet-logo";

/**
 * The signed-out card, matching Login01.
 *
 * The reset page used to paint its own greys — `bg-white`, `text-neutral-900`,
 * `border-neutral-300`. On a dark theme that produced a white card whose input
 * inherited near-white text, so what you typed was invisible. Everything here
 * goes through theme tokens instead, and every signed-out page shares this
 * shell so none of them can drift again.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Usually the way back to sign-in. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-background p-4">
      <div className="relative my-auto w-full max-w-sm">
        <div className="absolute bottom-full left-0 right-0 mb-6 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-highlight text-highlight-foreground">
            <VerletLogo className="h-6 w-6" />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {footer ? <div className="mt-4 text-center text-sm">{footer}</div> : null}
      </div>
    </div>
  );
}

/** "Back to sign in", styled once. */
export function BackToSignIn() {
  return (
    <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">
      Back to sign in
    </Link>
  );
}
