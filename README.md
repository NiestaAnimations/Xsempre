# Xsempre

Album per due account autorizzati. L’accesso usa Firebase Authentication; i ricordi, le frasi e i desideri vengono caricati da Firestore solo dopo l’accesso. Le regole Firestore verificano che l’email sia verificata e che l’UID dell’account sia nell’elenco autorizzato.

## Prima configurazione

Nel progetto Firebase `xsempre-album-2026-niesta`:

1. Attiva il provider **Email/Password** in Authentication.
2. Abilita l’API Firestore e crea un database **Standard** nella regione `europe-west1`.
3. Pubblica le regole con `firebase deploy --only firestore:rules`.
4. Avvia il sito con `npm run dev`, crea un account e verifica l’email. Solo l’UID autorizzato nelle regole può accedere ai dati.
5. Al primo accesso, seleziona `private-seed.json` per copiare i ricordi iniziali nel database. L’importazione avviene una volta sola.

Per autorizzare Sonia, dopo che avrà verificato il suo account, aggiungi il suo UID all’elenco `isAlbumMember()` in `firestore.rules` e ridistribuisci le regole. La registrazione può essere usata anche da altri, ma solo gli UID elencati nelle regole possono leggere o modificare i dati dell’album.

## Sviluppo e pubblicazione

- `npm run dev` avvia il sito in locale.
- `npm run build` crea la versione statica in `dist`.
- `npm run deploy` pubblica Hosting e le regole Firestore.
- GitHub Actions pubblica la build su GitHub Pages quando viene aggiornato il branch `main`.

Per GitHub Pages, imposta nelle variabili del repository i valori `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` e `VITE_FIREBASE_APP_ID`. Aggiungi anche `niestaanimations.github.io` tra i domini autorizzati di Firebase Authentication.

Il repository e i file HTML, CSS e JavaScript pubblicati da GitHub Pages sono pubblici. I contenuti personali non sono inclusi nella build: vengono letti da Firestore, le cui regole consentono l’accesso solo agli account autorizzati e verificati. `private-seed.json` e `.env.local` sono esclusi da Git. Le foto restano disattivate finché non viene scelta esplicitamente la fatturazione Firebase Blaze.
