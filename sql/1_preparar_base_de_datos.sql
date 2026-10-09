-- =====================================================================
-- Tablero Kanban de Obra - preparación de la base de datos (Supabase)
-- Pegue TODO este texto en: Supabase > SQL Editor > New query > Run
-- ANTES de ejecutarlo, cambie la última línea por SU correo.
-- =====================================================================

-- 1) Tabla única donde viven tareas, equipo, comités y ajustes
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- 2) Lista de personas autorizadas (solo ellas ven y editan los datos)
create table if not exists public.members (
  email text primary key,
  name  text,
  role  text not null default 'editor' check (role in ('admin','editor','viewer'))
);

alter table public.docs    enable row level security;
alter table public.members enable row level security;
alter table public.docs replica identity full;

-- 3) Funciones de apoyo para los permisos
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; res jsonb := a;
begin
  if jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    for k in select jsonb_object_keys(b) loop
      if res ? k and jsonb_typeof(res -> k) = 'object' and jsonb_typeof(b -> k) = 'object' then
        res := jsonb_set(res, array[k], public.jsonb_deep_merge(res -> k, b -> k));
      else
        res := jsonb_set(res, array[k], b -> k, true);
      end if;
    end loop;
    return res;
  end if;
  return b;
end $$;

-- Actualiza solo los campos enviados (por ejemplo, un asistente de un comité)
create or replace function public.merge_doc(p_collection text, p_id text, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into public.docs (collection, id, data, updated_at)
  values (p_collection, p_id, p_patch, now())
  on conflict (collection, id) do update
    set data = public.jsonb_deep_merge(public.docs.data, excluded.data),
        updated_at = now();
end $$;

-- 4) Permisos
drop policy if exists docs_leer     on public.docs;
drop policy if exists docs_escribir on public.docs;
create policy docs_leer on public.docs for select to authenticated
  using (public.my_role() is not null);
create policy docs_escribir on public.docs for all to authenticated
  using (public.my_role() in ('admin','editor'))
  with check (public.my_role() in ('admin','editor'));

drop policy if exists members_leer     on public.members;
drop policy if exists members_escribir on public.members;
create policy members_leer on public.members for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')) or public.my_role() = 'admin');
create policy members_escribir on public.members for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 5) Sincronización en tiempo real
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 6) Su usuario administrador  >>>> CAMBIE EL CORREO <<<<
insert into public.members (email, name, role)
values (lower('PEGUE_AQUI_SU_CORREO@ejemplo.com'), 'Administrador', 'admin')
on conflict (email) do update set role = 'admin';
