// Seite 1: Honorarnote einreichen (Autor:in)
import { PDF_BUCKET, config } from '../supabase.js';
import { ART_LABEL, esc, parseBetrag } from '../lib/format.js';
import { ibanFehler, normalizeIban, formatIban, normalizeBic, bicIstGueltig } from '../lib/iban.js';
import { fehlerText, meldung, mitSperre } from '../lib/ui.js';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function feld({ name, label, typ = 'text', pflicht = true, attrs = '', hinweis = '' }) {
  return `
    <div class="feld">
      <label for="f-${name}">${esc(label)}${pflicht ? ' <span class="pflicht" aria-hidden="true">*</span>' : ' <span class="optional">(optional)</span>'}</label>
      <input id="f-${name}" name="${name}" type="${typ}" ${pflicht ? 'required' : ''} ${attrs}
             aria-describedby="e-${name}${hinweis ? ` h-${name}` : ''}">
      ${hinweis ? `<p class="hinweis" id="h-${name}">${hinweis}</p>` : ''}
      <p class="feldfehler" id="e-${name}"></p>
    </div>`;
}

export async function render(el, { supabase, session, navigate, setFlash, istAktuell }) {
  const kontakt = config.datenschutzKontakt
    ? ` Fragen, Auskunft oder Löschung: <a href="mailto:${esc(config.datenschutzKontakt)}">${esc(config.datenschutzKontakt)}</a>.`
    : '';

  el.innerHTML = `
    <section class="karte">
      <h1>Honorarnote einreichen</h1>
      <p class="einleitung">Felder mit <span class="pflicht">*</span> sind Pflicht.</p>
      <form id="note-form" novalidate>
        <fieldset>
          <legend>Deine Daten</legend>
          <div class="zeile">
            ${feld({ name: 'vorname', label: 'Vorname', attrs: 'autocomplete="given-name" maxlength="100"' })}
            ${feld({ name: 'nachname', label: 'Nachname', attrs: 'autocomplete="family-name" maxlength="100"' })}
          </div>
          ${feld({ name: 'email', label: 'E-Mail', typ: 'email', attrs: 'autocomplete="email" inputmode="email" maxlength="200"',
                   hinweis: 'An diese Adresse schicken wir Infos zum Status.' })}
          <div class="feld">
            <label for="f-adresse">Adresse <span class="pflicht" aria-hidden="true">*</span></label>
            <textarea id="f-adresse" name="adresse" rows="2" required autocomplete="street-address" maxlength="300"
                      aria-describedby="e-adresse" placeholder="Straße Nr., PLZ Ort"></textarea>
            <p class="feldfehler" id="e-adresse"></p>
          </div>
        </fieldset>

        <fieldset>
          <legend>Bankverbindung</legend>
          ${feld({ name: 'kontoinhaber', label: 'Kontoinhaber:in', attrs: 'autocomplete="name" maxlength="70"' })}
          ${feld({ name: 'iban', label: 'IBAN', attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="42" placeholder="AT.. .... .... .... ...."' })}
          ${feld({ name: 'bic', label: 'BIC', pflicht: false, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="11"' })}
        </fieldset>

        <fieldset>
          <legend>Leistung</legend>
          <div class="feld">
            <label for="f-art">Art der Leistung <span class="pflicht" aria-hidden="true">*</span></label>
            <select id="f-art" name="art" required aria-describedby="e-art">
              <option value="">Bitte wählen …</option>
              ${Object.entries(ART_LABEL).map(([w, l]) => `<option value="${w}">${esc(l)}</option>`).join('')}
            </select>
            <p class="feldfehler" id="e-art"></p>
          </div>
          ${feld({ name: 'titel', label: 'Titel bzw. Beschreibung der Leistung', attrs: 'maxlength="200"' })}
          ${feld({ name: 'ausgabe', label: 'Ausgabe oder Erscheinungsdatum', pflicht: false, attrs: 'maxlength="100" placeholder="z. B. Ausgabe 3/2026 oder 15.10.2026"' })}
          <div class="zeile">
            ${feld({ name: 'betrag', label: 'Betrag in EUR', attrs: 'inputmode="decimal" autocomplete="off" placeholder="0,00"' })}
            ${feld({ name: 'leistungsdatum', label: 'Leistungsdatum', typ: 'date' })}
          </div>
          <div class="feld">
            <label for="f-notiz">Notiz <span class="optional">(optional)</span></label>
            <textarea id="f-notiz" name="notiz" rows="3" maxlength="2000"></textarea>
          </div>
          <div class="feld">
            <label for="f-pdf">Eigene Honorarnote als PDF <span class="optional">(optional, max. 10 MB)</span></label>
            <input id="f-pdf" name="pdf" type="file" accept="application/pdf,.pdf" aria-describedby="e-pdf">
            <p class="feldfehler" id="e-pdf"></p>
          </div>
        </fieldset>

        <aside class="datenschutz" aria-label="Datenschutzhinweis">
          <strong>Datenschutz:</strong> Wir verarbeiten deine Angaben ausschließlich zur Abrechnung und
          Auszahlung deines Honorars. Adresse und Bankverbindung sehen nur du und die Buchhaltung –
          die Redaktion sieht sie nicht. Die Daten werden im Rahmen der gesetzlichen
          Aufbewahrungspflichten gespeichert und danach gelöscht.${kontakt}
        </aside>

        <p class="feldfehler" id="e-formular" role="alert"></p>
        <button class="btn btn-primaer btn-breit" type="submit">Honorarnote einreichen</button>
      </form>
    </section>`;

  const form = el.querySelector('#note-form');
  form.email.value = session.user.email ?? '';

  // Persönliche Daten aus der letzten eigenen Note vorausfüllen
  const { data: letzte } = await supabase
    .from('honorarnoten')
    .select('vorname, nachname, email, zahlung:honorarnoten_zahlung(adresse, kontoinhaber, iban, bic)')
    .eq('autor_id', session.user.id)
    .order('eingereicht_am', { ascending: false })
    .limit(1);
  if (!istAktuell()) return;
  if (letzte?.length) {
    const n = letzte[0];
    const z = Array.isArray(n.zahlung) ? n.zahlung[0] : n.zahlung;
    form.vorname.value = n.vorname;
    form.nachname.value = n.nachname;
    form.email.value = n.email;
    if (z) {
      form.adresse.value = z.adresse;
      form.kontoinhaber.value = z.kontoinhaber;
      form.iban.value = formatIban(z.iban);
      form.bic.value = z.bic ?? '';
    }
  }

  const setFehler = (name, text) => {
    const p = el.querySelector(`#e-${name}`);
    if (p) p.textContent = text || '';
    const input = form.elements[name];
    if (input?.setAttribute) input.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  // Fehlermeldung eines Feldes verschwindet, sobald es geändert wird
  const beiAenderung = (ev) => { if (ev.target.name) setFehler(ev.target.name, ''); };
  form.addEventListener('input', beiAenderung);
  form.addEventListener('change', beiAenderung);

  // Live-Prüfung der IBAN beim Verlassen des Feldes
  form.iban.addEventListener('blur', () => {
    if (!form.iban.value.trim()) return;
    const f = ibanFehler(form.iban.value);
    setFehler('iban', f);
    if (!f) form.iban.value = formatIban(form.iban.value);
  });
  form.bic.addEventListener('blur', () => {
    setFehler('bic', bicIstGueltig(form.bic.value) ? '' : 'Der BIC hat 8 oder 11 Zeichen, z. B. BKAUATWW.');
  });
  form.betrag.addEventListener('blur', () => {
    if (!form.betrag.value.trim()) return;
    setFehler('betrag', parseBetrag(form.betrag.value) ? '' : 'Bitte einen Betrag wie 120 oder 120,50 eingeben.');
  });

  function pruefen() {
    const f = {};
    const leer = (n) => !form.elements[n].value.trim();
    for (const n of ['vorname', 'nachname', 'adresse', 'kontoinhaber', 'titel']) {
      if (leer(n)) f[n] = 'Bitte ausfüllen.';
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.value.trim())) f.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
    const ibanF = ibanFehler(form.iban.value);
    if (ibanF) f.iban = ibanF;
    if (!bicIstGueltig(form.bic.value)) f.bic = 'Der BIC hat 8 oder 11 Zeichen, z. B. BKAUATWW.';
    if (!form.art.value) f.art = 'Bitte wählen.';
    const betrag = parseBetrag(form.betrag.value);
    if (!betrag) f.betrag = 'Bitte einen Betrag wie 120 oder 120,50 eingeben.';
    else if (betrag > 100000) f.betrag = 'Der Betrag ist zu hoch.';
    if (!form.leistungsdatum.value) f.leistungsdatum = 'Bitte Datum wählen.';
    const pdf = form.pdf.files[0];
    if (pdf && !(pdf.type === 'application/pdf' || /\.pdf$/i.test(pdf.name))) f.pdf = 'Bitte nur PDF-Dateien hochladen.';
    else if (pdf && pdf.size > MAX_PDF_BYTES) f.pdf = 'Die Datei ist größer als 10 MB.';
    return { fehler: f, betrag, pdf };
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    for (const n of ['vorname', 'nachname', 'email', 'adresse', 'kontoinhaber', 'iban', 'bic', 'art',
      'titel', 'betrag', 'leistungsdatum', 'pdf', 'formular']) setFehler(n, '');

    const { fehler, betrag, pdf } = pruefen();
    const namen = Object.keys(fehler);
    if (namen.length) {
      namen.forEach((n) => setFehler(n, fehler[n]));
      form.elements[namen[0]]?.focus();
      setFehler('formular', 'Bitte die markierten Felder prüfen.');
      return;
    }

    await mitSperre(form.querySelector('button[type=submit]'), async () => {
      let pdfPfad = null;
      try {
        if (pdf) {
          pdfPfad = `${session.user.id}/${crypto.randomUUID()}.pdf`;
          const { error } = await supabase.storage.from(PDF_BUCKET)
            .upload(pdfPfad, pdf, { contentType: 'application/pdf', upsert: false });
          if (error) {
            pdfPfad = null;
            throw new Error('PDF-Upload fehlgeschlagen: ' + fehlerText(error));
          }
        }

        const { data, error } = await supabase.rpc('honorarnote_einreichen', {
          p_vorname: form.vorname.value.trim(),
          p_nachname: form.nachname.value.trim(),
          p_email: form.email.value.trim(),
          p_adresse: form.adresse.value.trim(),
          p_kontoinhaber: form.kontoinhaber.value.trim(),
          p_iban: normalizeIban(form.iban.value),
          p_bic: normalizeBic(form.bic.value) || null,
          p_art: form.art.value,
          p_titel: form.titel.value.trim(),
          p_ausgabe: form.ausgabe.value.trim() || null,
          p_betrag: betrag,
          p_leistungsdatum: form.leistungsdatum.value,
          p_notiz: form.notiz.value.trim() || null,
          p_pdf_path: pdfPfad,
        });
        if (error) throw error;

        setFlash({ neu: data.nummer });
        meldung(`Honorarnote ${data.nummer} wurde eingereicht.`, 'erfolg');
        navigate('meine');
      } catch (e) {
        // Hochgeladenes PDF wieder entfernen, wenn das Einreichen scheitert
        if (pdfPfad) await supabase.storage.from(PDF_BUCKET).remove([pdfPfad]);
        setFehler('formular', fehlerText(e));
      }
    });
  });
}
