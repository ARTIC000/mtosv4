import { getAuthedUser } from "@/lib/auth";

import { MonthlyTouchApp } from "@/components/monthly-touch-app";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getAuthedUser();

  const toast = typeof params.toast === "string" ? params.toast : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return <MonthlyTouchApp initialUser={user} initialToast={toast} initialError={error} />;
}
