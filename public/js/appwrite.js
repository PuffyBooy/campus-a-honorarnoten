// Appwrite-Client (Backend für den echten Betrieb).
// Endpoint und Projekt-ID sind öffentlich und dürfen im Frontend stehen.
// Einen API-Key NIEMALS hier eintragen – der gehört nur in Appwrite Functions.
import { Client } from '../vendor/appwrite.mjs';

export const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '6ab7ccc3003d09ca2ac8';
export const APPWRITE_PROJECT_NAME = 'campus a honorarnoten';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

export { client };

/**
 * Prüft einmal beim Start die Verbindung zu Appwrite und schreibt das Ergebnis
 * in die Browser-Konsole. Ein Fehler stört die App nicht.
 */
export async function appwritePing() {
  try {
    const antwort = await client.ping();
    console.info(`Appwrite verbunden (${APPWRITE_PROJECT_NAME}):`, antwort);
    return true;
  } catch (e) {
    console.warn(`Appwrite nicht erreichbar (${APPWRITE_ENDPOINT}):`, e?.message ?? e);
    return false;
  }
}
