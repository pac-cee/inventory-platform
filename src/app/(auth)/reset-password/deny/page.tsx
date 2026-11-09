import { DecisionForm } from "../decision-form";

/** The "this wasn't me" link from the confirmation email. */
export default async function DenyPasswordChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <DecisionForm token={token} decision="deny" />;
}
