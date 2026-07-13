import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/actions/auth";

export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAppUser();
  if (!user) redirect("/login");

  return <div className="min-h-screen bg-muted/30 print:bg-white">{children}</div>;
}
