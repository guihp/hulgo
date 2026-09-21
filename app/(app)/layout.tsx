import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUser, signOut } from "@/lib/actions/auth";
import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const user = await getAppUser();

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Conta sem acesso ao painel</CardTitle>
            <CardDescription>
              Seu login foi reconhecido ({authUser.email}), mas ainda não há um
              perfil vinculado em <code>app_usuarios</code>. Peça ao administrador
              para liberar seu acesso ou execute no Supabase:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
{`INSERT INTO app_usuarios (id, nome, papel)
VALUES ('${authUser.id}', 'Seu Nome', 'advogado');`}
            </pre>
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Sair e tentar outra conta
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AppShell user={user}>{children}</AppShell>;
}
