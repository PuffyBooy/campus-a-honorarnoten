// PHP-Funktionen des Servers aus den Tests aufrufen (über tests/php/aufruf.php)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKRIPT = fileURLToPath(new URL('./php/aufruf.php', import.meta.url));
const PHP = process.env.HONORARE_PHP || 'php';

/** Mehrere Aufrufe auf einmal: [{fn, args}] -> [{ok} | {fehler}] */
export function phpAufrufe(aufrufe) {
  return JSON.parse(execFileSync(PHP, [SKRIPT], { input: JSON.stringify(aufrufe), encoding: 'utf8' }));
}

/** Ein Aufruf; wirft bei Fehlern */
export function php(fn, ...args) {
  const [r] = phpAufrufe([{ fn, args }]);
  if ('fehler' in r) throw new Error(r.fehler);
  return r.ok;
}
