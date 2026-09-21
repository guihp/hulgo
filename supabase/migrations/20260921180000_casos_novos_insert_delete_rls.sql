-- casos_novos had SELECT/UPDATE only; authenticated INSERT failed with 42501.
CREATE POLICY casos_insert ON public.casos_novos
  FOR INSERT TO authenticated
  WITH CHECK (app_private.is_authenticated_user());

CREATE POLICY casos_delete ON public.casos_novos
  FOR DELETE TO authenticated
  USING (app_private.is_authenticated_user());
