import { LoginForm } from "./login-form";
import { MOCK } from "@/lib/api/mock";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <LoginForm
      error={error}
      message={message}
      demo={MOCK ? { email: "admin@verlet.io", password: "demo" } : undefined}
    />
  );
}
