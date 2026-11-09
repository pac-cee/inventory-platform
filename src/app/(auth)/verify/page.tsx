import { VerifyForm } from "./verify-form";

/** Three ways in: the emailed link (token), straight after signup, or bounced
 *  here by a login attempt on an account that is still unverified. */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; signedup?: string; unverified?: string }>;
}) {
  const { token, signedup, unverified } = await searchParams;
  const arrivedFrom = signedup ? "signup" : unverified ? "login" : undefined;
  return <VerifyForm token={token} arrivedFrom={arrivedFrom} />;
}
