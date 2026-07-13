import { redirect } from "next/navigation";

export default async function AtendimentoDetailPage({
  params,
}: {
  params: Promise<{ contact: string }>;
}) {
  const { contact } = await params;
  redirect(`/atendimentos?contact=${encodeURIComponent(contact)}`);
}
