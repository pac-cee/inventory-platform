import { DecisionForm } from "../decision-form";

/** The "yes, it was me" link from the confirmation email. */
export default async function ConfirmPasswordChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <DecisionForm token={token} decision="confirm" />;
}
