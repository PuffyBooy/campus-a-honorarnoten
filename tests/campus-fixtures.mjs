// Nachgebaute Seiten von campus-a-college.at (gleicher Aufbau wie die echten TYPO3-Seiten, erfundene Inhalte)
const BASIS = 'https://www.campus-a-college.at';
const PROFIL = 'ae1054937a1ae033e117';

const karte = (slug, titel, ressort) => `
  <div class="swiper-slide news-card group">
    <div class="news-card-media relative">
      <a class="group" title="${titel}" href="/news/detail/${slug}"><img class="news-card-image" src="/x.jpg" alt="" /></a>
    </div>
    <div class="news-card-body">
      <span class="news-card-kicker"> <span>${ressort}</span> </span>
      <a class="news-card-title-link" title="${titel}" href="/news/detail/${slug}"> ${titel} </a>
      <div class="news-card-meta"><span class="text-xs">Anna Müller</span><span class="text-xs"> 4 Min. </span></div>
    </div>
  </div>`;

const seitenLink = (nr) => `<a href="/profil/${PROFIL}?fetchNews=1&amp;tx_news_pi1%5Bcontroller%5D=News&amp;tx_news_pi1%5BcurrentPage%5D=${nr}&amp;cHash=abc${nr}">${nr}</a>`;

export const listeSeite1 = `<!DOCTYPE html><html><body>
  <div class="news-card-kicker"><span>Nicht aus der Liste</span></span>
  <div id="newsSectionWrapper"><div id="newsSection">
    <h2>Veröffentlichte Artikel</h2>
    ${karte('das-packerl-wird-teurer', 'Das Packerl wird teurer', 'Wirtschaft')}
    ${karte('alter-bestaetigen-bitte', 'Alter best&auml;tigen, bitte', 'Politik')}
    <nav>${seitenLink(2)}</nav>
  </div></div></body></html>`;

export const listeSeite2 = `<!DOCTYPE html><html><body>
  <div id="newsSection">
    ${karte('der-freie-platz', 'Der freie Platz', 'Panorama')}
    ${karte('das-packerl-wird-teurer', 'Das Packerl wird teurer', 'Wirtschaft')}
    <nav>${seitenLink(1)}</nav>
  </div></body></html>`;

export const artikelSeite = ({ titel, ressort, region, kategorie, datum }) => `<!DOCTYPE html><html><body>
  <div class="news news-single"><div class="article" itemscope itemtype="https://schema.org/NewsArticle">
  <article class="mx-auto bg-white">
    <div class="flex"><div class="mb-3 flex gap-2 text-xs font-bold uppercase text-primary">
      <span class="after:mx-2 after:content-['·']"> <a href="/beitraege/x" class="hover:underline">${ressort}</a> </span>
      <span class="after:mx-2 after:content-['·']"> ${region} </span>
      <span class="after:mx-2 after:content-['·'] last:after:content-['']"> <a class="hover:underline" title=" ${kategorie}" href="/kategorien/kat/${kategorie.toLowerCase()}"> ${kategorie} </a> </span>
    </div></div>
    <h1 itemprop="headline" class="text-3xl"> ${titel} </h1>
    <div class="mb-7 text-xs"><span itemprop="author"><span itemprop="name">Anna Müller</span></span>
      <span>3</span> <span>Kommentare</span>
      <span><svg><path d="M2 12"/></svg> <div> ${datum} </div> </span>
    </div>
  </article></div></div></body></html>`;

const seiten = {
  [`${BASIS}/profil/${PROFIL}?fetchNews=1`]: listeSeite1,
  [`${BASIS}/profil/${PROFIL}?fetchNews=1&tx_news_pi1%5Bcontroller%5D=News&tx_news_pi1%5BcurrentPage%5D=1&cHash=abc1`]: listeSeite1,
  [`${BASIS}/profil/${PROFIL}?fetchNews=1&tx_news_pi1%5Bcontroller%5D=News&tx_news_pi1%5BcurrentPage%5D=2&cHash=abc2`]: listeSeite2,
  [`${BASIS}/news/detail/das-packerl-wird-teurer`]: artikelSeite({
    titel: 'Das Packerl wird teurer', ressort: 'Wirtschaft', region: 'International', kategorie: 'Meinung', datum: '28.09.2026',
  }),
  [`${BASIS}/news/detail/alter-bestaetigen-bitte`]: artikelSeite({
    titel: 'Alter bestätigen, bitte', ressort: 'Politik', region: 'Österreich', kategorie: 'Fakten', datum: '20.09.2026',
  }),
  [`${BASIS}/news/detail/der-freie-platz`]: artikelSeite({
    titel: 'Der freie Platz', ressort: 'Panorama', region: 'Wien', kategorie: 'Meinung', datum: '01.08.2026',
  }),
};

/** Zähler und Schalter für die Tests */
export const campusSeiten = { abrufe: 0, kaputt: false };

/** Ersatz für den echten Abruf: liefert die nachgebauten Seiten */
export async function campusHolen(url) {
  campusSeiten.abrufe++;
  if (campusSeiten.kaputt) throw new Error('nicht erreichbar');
  if (!Object.hasOwn(seiten, url)) throw new Error(`HTTP 404 für ${url}`);
  return seiten[url];
}
