-- =============================================================================
-- campus a college – Honorarnoten
-- Datenbankschema, Rollenrechte (Row Level Security) und Geschäftslogik
--
-- Grundprinzip:
--   * Lesen:     direkt über die Tabellen, eingeschränkt durch RLS-Policies.
--   * Schreiben: NUR über die RPC-Funktionen unten (security definer). Diese
--                prüfen Rolle, Status-Übergang und Pflichtfelder und schreiben
--                den Verlauf. Direkte INSERT/UPDATE/DELETE-Rechte auf die
--                Tabellen gibt es für eingeloggte Nutzer:innen nicht.
--   * IBAN, BIC, Kontoinhaber:in und Adresse liegen in einer eigenen Tabelle
--     (honorarnoten_zahlung), die die Redaktion nicht lesen darf.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Typen
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('autor', 'redaktion', 'buchhaltung', 'admin');
create type public.note_status as enum ('eingereicht', 'angenommen', 'abgelehnt', 'bezahlt');
create type public.leistungsart as enum ('artikel', 'kommentar', 'foto', 'video', 'sonstiges');

-- -----------------------------------------------------------------------------
-- Hilfsfunktion: IBAN-Prüfung (Länderlänge + Prüfsumme mod 97)
-- -----------------------------------------------------------------------------
create function public.iban_ist_gueltig(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  s     text;
  ch    text;
  rest  int := 0;
  i     int;
  laengen constant jsonb := '{
    "AD":24,"AT":20,"BE":16,"BG":22,"CH":21,"CY":28,"CZ":24,"DE":22,"DK":18,
    "EE":20,"ES":24,"FI":18,"FR":27,"GB":22,"GI":23,"GR":27,"HR":21,"HU":28,
    "IE":22,"IS":26,"IT":27,"LI":21,"LT":20,"LU":20,"LV":21,"MC":27,"MT":31,
    "NL":18,"NO":15,"PL":28,"PT":25,"RO":24,"SE":24,"SI":19,"SK":24,"SM":27,
    "VA":22}';
begin
  if p_iban is null then
    return false;
  end if;
  s := upper(regexp_replace(p_iban, '\s', '', 'g'));
  if s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  if laengen ? left(s, 2) and (laengen ->> left(s, 2))::int <> length(s) then
    return false;
  end if;
  s := substr(s, 5) || left(s, 4);
  for i in 1 .. length(s) loop
    ch := substr(s, i, 1);
    if ch between '0' and '9' then
      rest := (rest * 10 + ch::int) % 97;
    else
      rest := (rest * 100 + ascii(ch) - 55) % 97;
    end if;
  end loop;
  return rest = 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabellen
-- -----------------------------------------------------------------------------

-- Profil pro Login (wird automatisch beim ersten Login angelegt)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  anzeigename text,
  created_at  timestamptz not null default now()
);

-- Rollen: eine Zeile pro (Person, Rolle). Vergabe durch Admin per SQL.
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Fortlaufende Nummer pro Jahr (CC-2026-0001, CC-2026-0002, ...)
create table public.note_counters (
  jahr          int primary key,
  letzte_nummer int not null
);

-- Honorarnote: alles, was die Redaktion sehen darf
create table public.honorarnoten (
  id                 uuid primary key default gen_random_uuid(),
  nummer             text not null unique,
  autor_id           uuid references auth.users (id) on delete set null,
  status             public.note_status not null default 'eingereicht',

  vorname            text not null,
  nachname           text not null,
  email              text not null,

  art                public.leistungsart not null,
  titel              text not null,
  ausgabe            text,
  leistungsdatum     date not null,
  notiz              text,
  pdf_path           text,

  betrag             numeric(10, 2) not null check (betrag > 0),
  betrag_eingereicht numeric(10, 2) not null check (betrag_eingereicht > 0),
  betrag_vermerk     text,          -- Pflicht-Vermerk bei Korrektur (für Autor:in sichtbar)

  ablehnungsgrund    text,          -- für Autor:in sichtbar
  eingereicht_am     timestamptz not null default now(),
  entschieden_am     timestamptz,
  bezahlt_am         date,
  aktualisiert_am    timestamptz not null default now(),

  constraint ablehnung_braucht_grund
    check (status <> 'abgelehnt' or coalesce(btrim(ablehnungsgrund), '') <> ''),
  constraint bezahlt_braucht_datum
    check (status <> 'bezahlt' or bezahlt_am is not null)
);

create index honorarnoten_autor_idx  on public.honorarnoten (autor_id);
create index honorarnoten_status_idx on public.honorarnoten (status);
create index honorarnoten_bezahlt_idx on public.honorarnoten (bezahlt_am) where status = 'bezahlt';

-- Personenbezogene Zahlungsdaten (1:1). Redaktion hat KEINEN Lesezugriff.
create table public.honorarnoten_zahlung (
  note_id      uuid primary key references public.honorarnoten (id) on delete cascade,
  adresse      text not null,
  kontoinhaber text not null,
  iban         text not null check (public.iban_ist_gueltig(iban)),
  bic          text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$')
);

-- Interne Kommentare der Redaktion (Autor:in und Buchhaltung sehen sie nicht)
create table public.interne_kommentare (
  id             bigint generated always as identity primary key,
  note_id        uuid not null references public.honorarnoten (id) on delete cascade,
  verfasser_id   uuid references auth.users (id) on delete set null,
  verfasser_name text not null,
  text           text not null check (btrim(text) <> ''),
  erstellt_am    timestamptz not null default now()
);
create index interne_kommentare_note_idx on public.interne_kommentare (note_id);

-- Verlauf: wer hat wann was geändert (enthält nie IBAN oder Adresse)
create table public.note_verlauf (
  id          bigint generated always as identity primary key,
  note_id     uuid not null references public.honorarnoten (id) on delete cascade,
  akteur_id   uuid references auth.users (id) on delete set null,
  akteur_name text not null,
  aktion      text not null,
  details     jsonb not null default '{}'::jsonb,
  erstellt_am timestamptz not null default now()
);
create index note_verlauf_note_idx on public.note_verlauf (note_id);

-- Protokoll gelöschter Noten (ohne personenbezogene Daten)
create table public.loeschprotokoll (
  id             bigint generated always as identity primary key,
  nummer         text not null,
  geloescht_von  uuid references auth.users (id) on delete set null,
  geloescht_name text not null,
  geloescht_am   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Rollen-Hilfsfunktionen (werden in Policies verwendet)
-- -----------------------------------------------------------------------------
create function public.hat_rolle(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = p_role
  );
$$;

create function public.ist_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.hat_rolle('admin'); $$;

create function public.ist_redaktion()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.hat_rolle('redaktion') or public.hat_rolle('admin'); $$;

create function public.ist_buchhaltung()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.hat_rolle('buchhaltung') or public.hat_rolle('admin'); $$;

-- Für das Frontend (nur zur Anzeige der Menüpunkte; Rechte prüft die DB)
create function public.meine_rollen()
returns public.app_role[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(role order by role), '{}')
  from public.user_roles where user_id = auth.uid();
$$;

-- Name der handelnden Person für Verlauf/Kommentare
create function public._akteur_name()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(btrim(anzeigename), ''), email)
       from public.profiles where id = auth.uid()),
    'unbekannt');
$$;

create function public._verlauf(p_note uuid, p_aktion text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.note_verlauf (note_id, akteur_id, akteur_name, aktion, details)
  values (p_note, auth.uid(), public._akteur_name(), p_aktion, coalesce(p_details, '{}'::jsonb));
$$;

-- Leere/Whitespace-Strings zu NULL
create function public._leer_zu_null(p text)
returns text language sql immutable set search_path = ''
as $$ select nullif(btrim(p), ''); $$;

-- -----------------------------------------------------------------------------
-- Neue Nutzer:innen: Profil + Standardrolle "autor"
-- -----------------------------------------------------------------------------
create function public._neuer_benutzer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'autor')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._neuer_benutzer();

-- -----------------------------------------------------------------------------
-- RPC: Honorarnote einreichen (Autor:in)
-- -----------------------------------------------------------------------------
create function public.honorarnote_einreichen(
  p_vorname        text,
  p_nachname       text,
  p_email          text,
  p_adresse        text,
  p_kontoinhaber   text,
  p_iban           text,
  p_bic            text,
  p_art            public.leistungsart,
  p_titel          text,
  p_ausgabe        text,
  p_betrag         numeric,
  p_leistungsdatum date,
  p_notiz          text default null,
  p_pdf_path       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_jahr   int  := extract(year from (now() at time zone 'Europe/Vienna'))::int;
  v_nr     int;
  v_nummer text;
  v_id     uuid;
  v_iban   text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  v_bic    text := public._leer_zu_null(upper(regexp_replace(coalesce(p_bic, ''), '\s', '', 'g')));
  v_pdf    text := public._leer_zu_null(p_pdf_path);
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '42501';
  end if;
  if not public.hat_rolle('autor') then
    raise exception 'Keine Berechtigung zum Einreichen.' using errcode = '42501';
  end if;

  if public._leer_zu_null(p_vorname) is null or public._leer_zu_null(p_nachname) is null then
    raise exception 'Vor- und Nachname sind Pflichtfelder.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Bitte eine gültige E-Mail-Adresse angeben.' using errcode = '22023';
  end if;
  if public._leer_zu_null(p_adresse) is null or public._leer_zu_null(p_kontoinhaber) is null then
    raise exception 'Adresse und Kontoinhaber:in sind Pflichtfelder.' using errcode = '22023';
  end if;
  if not public.iban_ist_gueltig(v_iban) then
    raise exception 'Die IBAN ist ungültig.' using errcode = '22023';
  end if;
  if v_bic is not null and v_bic !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
    raise exception 'Der BIC ist ungültig.' using errcode = '22023';
  end if;
  if public._leer_zu_null(p_titel) is null then
    raise exception 'Titel bzw. Beschreibung ist ein Pflichtfeld.' using errcode = '22023';
  end if;
  if p_betrag is null or p_betrag <= 0 or p_betrag > 100000 or p_betrag <> round(p_betrag, 2) then
    raise exception 'Bitte einen gültigen Betrag angeben.' using errcode = '22023';
  end if;
  if p_leistungsdatum is null then
    raise exception 'Leistungsdatum ist ein Pflichtfeld.' using errcode = '22023';
  end if;
  -- PDF darf nur aus dem eigenen Upload-Ordner stammen
  if v_pdf is not null and (v_pdf not like v_uid::text || '/%' or v_pdf !~* '\.pdf$') then
    raise exception 'Ungültiger PDF-Pfad.' using errcode = '22023';
  end if;

  insert into public.note_counters as c (jahr, letzte_nummer) values (v_jahr, 1)
  on conflict (jahr) do update set letzte_nummer = c.letzte_nummer + 1
  returning letzte_nummer into v_nr;
  v_nummer := format('CC-%s-%s', v_jahr, lpad(v_nr::text, 4, '0'));

  insert into public.honorarnoten (
    nummer, autor_id, vorname, nachname, email, art, titel, ausgabe,
    leistungsdatum, notiz, pdf_path, betrag, betrag_eingereicht)
  values (
    v_nummer, v_uid, btrim(p_vorname), btrim(p_nachname), lower(btrim(p_email)), p_art,
    btrim(p_titel), public._leer_zu_null(p_ausgabe), p_leistungsdatum,
    public._leer_zu_null(p_notiz), v_pdf, p_betrag, p_betrag)
  returning id into v_id;

  insert into public.honorarnoten_zahlung (note_id, adresse, kontoinhaber, iban, bic)
  values (v_id, btrim(p_adresse), btrim(p_kontoinhaber), v_iban, v_bic);

  -- Anzeigenamen beim ersten Einreichen übernehmen
  update public.profiles
     set anzeigename = btrim(p_vorname) || ' ' || btrim(p_nachname)
   where id = v_uid and coalesce(btrim(anzeigename), '') = '';

  perform public._verlauf(v_id, 'eingereicht', jsonb_build_object('betrag', p_betrag));

  return jsonb_build_object('id', v_id, 'nummer', v_nummer);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: Redaktion
-- -----------------------------------------------------------------------------
create function public.honorarnote_annehmen(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_status public.note_status;
begin
  if not public.ist_redaktion() then
    raise exception 'Nur die Redaktion darf Noten annehmen.' using errcode = '42501';
  end if;
  select status into v_status from public.honorarnoten where id = p_id for update;
  if not found then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_status not in ('eingereicht', 'abgelehnt') then
    raise exception 'Eine Note mit Status "%" kann nicht angenommen werden.', v_status using errcode = '22023';
  end if;

  update public.honorarnoten
     set status = 'angenommen', ablehnungsgrund = null,
         entschieden_am = now(), aktualisiert_am = now()
   where id = p_id;

  perform public._verlauf(p_id, 'angenommen', jsonb_build_object('vorher', v_status));
end;
$$;

create function public.honorarnote_ablehnen(p_id uuid, p_grund text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_status public.note_status;
begin
  if not public.ist_redaktion() then
    raise exception 'Nur die Redaktion darf Noten ablehnen.' using errcode = '42501';
  end if;
  if public._leer_zu_null(p_grund) is null then
    raise exception 'Bitte eine Begründung für die Ablehnung angeben.' using errcode = '22023';
  end if;
  select status into v_status from public.honorarnoten where id = p_id for update;
  if not found then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_status not in ('eingereicht', 'angenommen') then
    raise exception 'Eine Note mit Status "%" kann nicht abgelehnt werden.', v_status using errcode = '22023';
  end if;

  update public.honorarnoten
     set status = 'abgelehnt', ablehnungsgrund = btrim(p_grund),
         entschieden_am = now(), aktualisiert_am = now()
   where id = p_id;

  perform public._verlauf(p_id, 'abgelehnt',
    jsonb_build_object('vorher', v_status, 'grund', btrim(p_grund)));
end;
$$;

create function public.honorarnote_betrag_korrigieren(p_id uuid, p_betrag numeric, p_vermerk text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.note_status;
  v_alt    numeric;
begin
  if not public.ist_redaktion() then
    raise exception 'Nur die Redaktion darf Beträge korrigieren.' using errcode = '42501';
  end if;
  if public._leer_zu_null(p_vermerk) is null then
    raise exception 'Ein Vermerk zur Betragskorrektur ist Pflicht.' using errcode = '22023';
  end if;
  if p_betrag is null or p_betrag <= 0 or p_betrag > 100000 or p_betrag <> round(p_betrag, 2) then
    raise exception 'Bitte einen gültigen Betrag angeben.' using errcode = '22023';
  end if;
  select status, betrag into v_status, v_alt from public.honorarnoten where id = p_id for update;
  if not found then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_status = 'bezahlt' then
    raise exception 'Bezahlte Noten können nicht mehr geändert werden.' using errcode = '22023';
  end if;
  if v_alt = p_betrag then
    raise exception 'Der Betrag ist unverändert.' using errcode = '22023';
  end if;

  update public.honorarnoten
     set betrag = p_betrag, betrag_vermerk = btrim(p_vermerk), aktualisiert_am = now()
   where id = p_id;

  perform public._verlauf(p_id, 'betrag_korrigiert',
    jsonb_build_object('alt', v_alt, 'neu', p_betrag, 'vermerk', btrim(p_vermerk)));
end;
$$;

create function public.honorarnote_kommentieren(p_id uuid, p_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.ist_redaktion() then
    raise exception 'Nur die Redaktion darf interne Kommentare schreiben.' using errcode = '42501';
  end if;
  if public._leer_zu_null(p_text) is null then
    raise exception 'Der Kommentar ist leer.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.honorarnoten where id = p_id) then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;

  insert into public.interne_kommentare (note_id, verfasser_id, verfasser_name, text)
  values (p_id, auth.uid(), public._akteur_name(), btrim(p_text));

  perform public._verlauf(p_id, 'kommentar');
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Buchhaltung
-- -----------------------------------------------------------------------------
create function public.honorarnote_bezahlt(p_id uuid, p_datum date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_status public.note_status;
begin
  if not public.ist_buchhaltung() then
    raise exception 'Nur die Buchhaltung darf Zahlungen verbuchen.' using errcode = '42501';
  end if;
  if p_datum is null or p_datum > (now() at time zone 'Europe/Vienna')::date then
    raise exception 'Bitte ein gültiges Zahlungsdatum angeben (nicht in der Zukunft).' using errcode = '22023';
  end if;
  select status into v_status from public.honorarnoten where id = p_id for update;
  if not found then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;
  if v_status <> 'angenommen' then
    raise exception 'Nur angenommene Noten können als bezahlt markiert werden.' using errcode = '22023';
  end if;

  update public.honorarnoten
     set status = 'bezahlt', bezahlt_am = p_datum, aktualisiert_am = now()
   where id = p_id;

  perform public._verlauf(p_id, 'bezahlt', jsonb_build_object('datum', p_datum));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Admin – Note löschen (Datenschutz). Gibt den PDF-Pfad zurück, damit das
-- Frontend die Datei über die Storage-API entfernen kann.
-- -----------------------------------------------------------------------------
create function public.honorarnote_loeschen(p_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_nummer text;
  v_pdf    text;
begin
  if not public.ist_admin() then
    raise exception 'Nur Admins dürfen Noten löschen.' using errcode = '42501';
  end if;
  delete from public.honorarnoten where id = p_id returning nummer, pdf_path into v_nummer, v_pdf;
  if v_nummer is null then
    raise exception 'Honorarnote nicht gefunden.' using errcode = 'P0002';
  end if;
  insert into public.loeschprotokoll (nummer, geloescht_von, geloescht_name)
  values (v_nummer, auth.uid(), public._akteur_name());
  return v_pdf;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.note_counters        enable row level security;
alter table public.honorarnoten         enable row level security;
alter table public.honorarnoten_zahlung enable row level security;
alter table public.interne_kommentare   enable row level security;
alter table public.note_verlauf         enable row level security;
alter table public.loeschprotokoll      enable row level security;

-- profiles / user_roles: eigene Zeile; Admin alles
create policy "Profil: eigenes oder Admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.ist_admin());

create policy "Rollen: eigene oder Admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.ist_admin());

-- honorarnoten
create policy "Noten: Autor:in sieht eigene" on public.honorarnoten
  for select to authenticated
  using (autor_id = auth.uid());

create policy "Noten: Redaktion sieht alle" on public.honorarnoten
  for select to authenticated
  using (public.ist_redaktion());

create policy "Noten: Buchhaltung sieht angenommene und bezahlte" on public.honorarnoten
  for select to authenticated
  using (public.ist_buchhaltung() and status in ('angenommen', 'bezahlt'));

-- honorarnoten_zahlung (IBAN, Adresse): KEINE Policy für die Redaktion
create policy "Zahlungsdaten: Autor:in sieht eigene" on public.honorarnoten_zahlung
  for select to authenticated
  using (exists (
    select 1 from public.honorarnoten n
    where n.id = note_id and n.autor_id = auth.uid()));

create policy "Zahlungsdaten: Buchhaltung bei angenommenen/bezahlten" on public.honorarnoten_zahlung
  for select to authenticated
  using (public.ist_buchhaltung() and exists (
    select 1 from public.honorarnoten n
    where n.id = note_id and n.status in ('angenommen', 'bezahlt')));

-- Interne Kommentare und Verlauf: nur Redaktion (inkl. Admin)
create policy "Kommentare: nur Redaktion" on public.interne_kommentare
  for select to authenticated
  using (public.ist_redaktion());

create policy "Verlauf: nur Redaktion" on public.note_verlauf
  for select to authenticated
  using (public.ist_redaktion());

create policy "Löschprotokoll: nur Admin" on public.loeschprotokoll
  for select to authenticated
  using (public.ist_admin());

-- note_counters: keine Policy => kein Zugriff außer über Funktionen

-- -----------------------------------------------------------------------------
-- Tabellenrechte: nur SELECT (gefiltert durch RLS), Schreiben nur via RPC
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.user_roles, public.note_counters,
              public.honorarnoten, public.honorarnoten_zahlung,
              public.interne_kommentare, public.note_verlauf,
              public.loeschprotokoll
  from anon, authenticated;

grant select on public.profiles, public.user_roles, public.honorarnoten,
                public.honorarnoten_zahlung, public.interne_kommentare,
                public.note_verlauf, public.loeschprotokoll
  to authenticated;

-- Funktionsrechte: standardmäßig niemand, dann gezielt "authenticated"
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.iban_ist_gueltig(text),
  public.hat_rolle(public.app_role),
  public.ist_admin(),
  public.ist_redaktion(),
  public.ist_buchhaltung(),
  public.meine_rollen(),
  public.honorarnote_einreichen(text, text, text, text, text, text, text,
    public.leistungsart, text, text, numeric, date, text, text),
  public.honorarnote_annehmen(uuid),
  public.honorarnote_ablehnen(uuid, text),
  public.honorarnote_betrag_korrigieren(uuid, numeric, text),
  public.honorarnote_kommentieren(uuid, text),
  public.honorarnote_bezahlt(uuid, date),
  public.honorarnote_loeschen(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: privater Bucket für PDF-Honorarnoten
--   Pfad: <user-id>/<zufällige-id>.pdf
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('honorarnoten-pdf', 'honorarnoten-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Hochladen nur in den eigenen Ordner
create policy "PDF: Upload in eigenen Ordner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'honorarnoten-pdf'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.hat_rolle('autor'));

-- Lesen: eigene Dateien oder Datei gehört zu einer Note, die man sehen darf
-- (die Unterabfrage läuft mit den RLS-Rechten der anfragenden Person)
create policy "PDF: Lesen wie die zugehörige Note" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'honorarnoten-pdf'
    and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.honorarnoten n where n.pdf_path = name)));

-- Löschen: Admin, oder eigene Datei, solange sie noch keiner Note zugeordnet
-- ist (Aufräumen nach fehlgeschlagenem Einreichen)
create policy "PDF: Löschen" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'honorarnoten-pdf'
    and (public.ist_admin()
         or ((storage.foldername(name))[1] = auth.uid()::text
             and not exists (select 1 from public.honorarnoten n where n.pdf_path = name))));
