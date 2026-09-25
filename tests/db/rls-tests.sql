-- RLS- und Ablauf-Tests. Jede Prüfung bricht mit Fehler ab, wenn sie fehlschlägt.
\set ON_ERROR_STOP 1

-- Testpersonen (Trigger legt Profil + Rolle "autor" an)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'autorin@example.org'),
  ('00000000-0000-0000-0000-00000000000b', 'andere@example.org'),
  ('00000000-0000-0000-0000-00000000000c', 'redaktion@example.org'),
  ('00000000-0000-0000-0000-00000000000d', 'kasse@example.org'),
  ('00000000-0000-0000-0000-00000000000e', 'admin@example.org');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-00000000000c', 'redaktion'),
  ('00000000-0000-0000-0000-00000000000d', 'buchhaltung'),
  ('00000000-0000-0000-0000-00000000000e', 'admin');

create function pg_temp.als(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', p::text, false) $$;

create function pg_temp.pruefe(bedingung boolean, text text) returns void language plpgsql as
$$ begin if not coalesce(bedingung, false) then raise exception 'TEST FEHLGESCHLAGEN: %', text; end if; end $$;

create table pg_temp.ids (name text primary key, id uuid, nummer text);
grant all on pg_temp.ids to authenticated;

-- ---------------------------------------------------------------- IBAN
select pg_temp.pruefe(public.iban_ist_gueltig('AT61 1904 3002 3457 3201'), 'gültige AT-IBAN');
select pg_temp.pruefe(public.iban_ist_gueltig('DE89370400440532013000'), 'gültige DE-IBAN');
select pg_temp.pruefe(not public.iban_ist_gueltig('AT61 1904 3002 3457 3202'), 'falsche Prüfziffer');
select pg_temp.pruefe(not public.iban_ist_gueltig('AT61 1904 3002 3457 320'), 'falsche Länge');

-- ---------------------------------------------------------------- Einreichen
set role authenticated;
select pg_temp.als('00000000-0000-0000-0000-00000000000a');

select pg_temp.pruefe(public.meine_rollen() = '{autor}', 'Standardrolle autor');

insert into pg_temp.ids
select 'n1', (r->>'id')::uuid, r->>'nummer' from (select public.honorarnote_einreichen(
  'Anna', 'Autorin', 'Autorin@Example.org', 'Hauptstraße 1, 1010 Wien',
  'Anna Autorin', 'at61 1904 3002 3457 3201', 'bkauatww', 'artikel',
  'Reportage Schulball', 'Ausgabe 3/2026', 120.50, '2026-09-01', 'Bitte bald', null) r) s;

insert into pg_temp.ids
select 'n2', (r->>'id')::uuid, r->>'nummer' from (select public.honorarnote_einreichen(
  'Anna', 'Autorin', 'autorin@example.org', 'Hauptstraße 1, 1010 Wien',
  'Anna Autorin', 'AT611904300234573201', null, 'foto',
  'Fotostrecke', null, 40, '2026-09-02', null, null) r) s;

select pg_temp.pruefe((select nummer from pg_temp.ids where name = 'n1')
  = 'CC-' || extract(year from now() at time zone 'Europe/Vienna') || '-0001', 'Nummernformat CC-JJJJ-0001');
select pg_temp.pruefe((select nummer from pg_temp.ids where name = 'n2') like '%-0002', 'fortlaufende Nummer');
select pg_temp.pruefe((select iban from public.honorarnoten_zahlung
  where note_id = (select id from pg_temp.ids where name = 'n1')) = 'AT611904300234573201', 'IBAN normalisiert, Autor:in sieht eigene');
select pg_temp.pruefe((select bic from public.honorarnoten_zahlung
  where note_id = (select id from pg_temp.ids where name = 'n1')) = 'BKAUATWW', 'BIC normalisiert');

-- ungültige IBAN wird abgelehnt
do $$ begin
  perform public.honorarnote_einreichen('A','B','a@b.at','X','A B','AT00 0000 0000 0000 0000',null,'artikel','T',null,10,'2026-01-01',null,null);
  raise exception 'TEST FEHLGESCHLAGEN: ungültige IBAN akzeptiert';
exception when sqlstate '22023' then null; end $$;

-- fremder PDF-Pfad wird abgelehnt
do $$ begin
  perform public.honorarnote_einreichen('A','B','a@b.at','X','A B','AT611904300234573201',null,'artikel','T',null,10,'2026-01-01',null,
    '00000000-0000-0000-0000-00000000000b/x.pdf');
  raise exception 'TEST FEHLGESCHLAGEN: fremder PDF-Pfad akzeptiert';
exception when sqlstate '22023' then null; end $$;

-- Autor:in darf nicht direkt schreiben
do $$ begin
  update public.honorarnoten set status = 'bezahlt';
  raise exception 'TEST FEHLGESCHLAGEN: direktes UPDATE erlaubt';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.note_counters values (2099, 1);
  raise exception 'TEST FEHLGESCHLAGEN: direktes INSERT erlaubt';
exception when insufficient_privilege then null; end $$;

-- Autor:in darf nicht annehmen
do $$ begin
  perform public.honorarnote_annehmen((select id from pg_temp.ids where name = 'n1'));
  raise exception 'TEST FEHLGESCHLAGEN: Autor:in konnte annehmen';
exception when insufficient_privilege then null; end $$;

-- andere Autor:in sieht nichts
select pg_temp.als('00000000-0000-0000-0000-00000000000b');
select pg_temp.pruefe((select count(*) from public.honorarnoten) = 0, 'fremde Noten unsichtbar');
select pg_temp.pruefe((select count(*) from public.honorarnoten_zahlung) = 0, 'fremde Zahlungsdaten unsichtbar');

-- ---------------------------------------------------------------- Redaktion
select pg_temp.als('00000000-0000-0000-0000-00000000000c');
select pg_temp.pruefe((select count(*) from public.honorarnoten) = 2, 'Redaktion sieht alle Noten');
select pg_temp.pruefe((select count(*) from public.honorarnoten_zahlung) = 0, 'Redaktion sieht KEINE IBAN/Adresse');

do $$ begin
  perform public.honorarnote_ablehnen((select id from pg_temp.ids where name = 'n2'), '   ');
  raise exception 'TEST FEHLGESCHLAGEN: Ablehnen ohne Begründung';
exception when sqlstate '22023' then null; end $$;
select public.honorarnote_ablehnen((select id from pg_temp.ids where name = 'n2'), 'Fotos unscharf');

do $$ begin
  perform public.honorarnote_betrag_korrigieren((select id from pg_temp.ids where name = 'n1'), 100, '');
  raise exception 'TEST FEHLGESCHLAGEN: Korrektur ohne Vermerk';
exception when sqlstate '22023' then null; end $$;
select public.honorarnote_betrag_korrigieren((select id from pg_temp.ids where name = 'n1'), 100, 'Satz laut Honorarliste');
select public.honorarnote_kommentieren((select id from pg_temp.ids where name = 'n1'), 'Intern: passt');
select public.honorarnote_annehmen((select id from pg_temp.ids where name = 'n1'));

select pg_temp.pruefe((select count(*) from public.note_verlauf
  where note_id = (select id from pg_temp.ids where name = 'n1')) = 4, 'Verlauf vollständig');
select pg_temp.pruefe((select akteur_name from public.note_verlauf where aktion = 'angenommen')
  = 'redaktion@example.org', 'Verlauf nennt handelnde Person');

do $$ begin
  perform public.honorarnote_bezahlt((select id from pg_temp.ids where name = 'n1'), current_date);
  raise exception 'TEST FEHLGESCHLAGEN: Redaktion konnte bezahlen';
exception when insufficient_privilege then null; end $$;

-- ---------------------------------------------------------------- Autor:in sieht Ergebnis
select pg_temp.als('00000000-0000-0000-0000-00000000000a');
select pg_temp.pruefe((select ablehnungsgrund from public.honorarnoten
  where id = (select id from pg_temp.ids where name = 'n2')) = 'Fotos unscharf', 'Autor:in sieht Ablehnungsgrund');
select pg_temp.pruefe((select count(*) from public.interne_kommentare) = 0, 'Autor:in sieht keine internen Kommentare');
select pg_temp.pruefe((select count(*) from public.note_verlauf) = 0, 'Autor:in sieht keinen internen Verlauf');

-- ---------------------------------------------------------------- Buchhaltung
select pg_temp.als('00000000-0000-0000-0000-00000000000d');
select pg_temp.pruefe((select count(*) from public.honorarnoten) = 1, 'Buchhaltung sieht nur angenommene');
select pg_temp.pruefe((select count(*) from public.honorarnoten_zahlung) = 1, 'Buchhaltung sieht IBAN der angenommenen');
select pg_temp.pruefe((select count(*) from public.interne_kommentare) = 0, 'Buchhaltung sieht keine internen Kommentare');

do $$ begin
  perform public.honorarnote_bezahlt((select id from pg_temp.ids where name = 'n2'), current_date);
  raise exception 'TEST FEHLGESCHLAGEN: abgelehnte Note bezahlt';
exception when sqlstate '22023' or sqlstate 'P0002' then null; end $$;
do $$ begin
  perform public.honorarnote_bezahlt((select id from pg_temp.ids where name = 'n1'), current_date + 5);
  raise exception 'TEST FEHLGESCHLAGEN: Zahlungsdatum in der Zukunft';
exception when sqlstate '22023' then null; end $$;
select public.honorarnote_bezahlt((select id from pg_temp.ids where name = 'n1'), current_date);
select pg_temp.pruefe((select status from public.honorarnoten
  where id = (select id from pg_temp.ids where name = 'n1')) = 'bezahlt', 'Status bezahlt');

-- ---------------------------------------------------------------- Storage
select pg_temp.als('00000000-0000-0000-0000-00000000000a');
insert into storage.objects (bucket_id, name) values ('honorarnoten-pdf', '00000000-0000-0000-0000-00000000000a/eigen.pdf');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('honorarnoten-pdf', '00000000-0000-0000-0000-00000000000b/fremd.pdf');
  raise exception 'TEST FEHLGESCHLAGEN: Upload in fremden Ordner';
exception when insufficient_privilege then null; end $$;

-- ---------------------------------------------------------------- Admin
do $$ begin
  perform public.honorarnote_loeschen((select id from pg_temp.ids where name = 'n2'));
  raise exception 'TEST FEHLGESCHLAGEN: Autor:in konnte löschen';
exception when insufficient_privilege then null; end $$;

select pg_temp.als('00000000-0000-0000-0000-00000000000e');
select public.honorarnote_loeschen((select id from pg_temp.ids where name = 'n2'));
select pg_temp.pruefe((select count(*) from public.honorarnoten) = 1, 'Admin hat gelöscht');
select pg_temp.pruefe((select count(*) from public.loeschprotokoll) = 1, 'Löschung protokolliert');

-- ---------------------------------------------------------------- anon
reset role;
set role anon;
do $$ begin
  perform count(*) from public.honorarnoten;
  raise exception 'TEST FEHLGESCHLAGEN: anon kann lesen';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.meine_rollen();
  raise exception 'TEST FEHLGESCHLAGEN: anon kann RPC aufrufen';
exception when insufficient_privilege then null; end $$;
reset role;
