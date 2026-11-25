import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "./firebase.js";

const loginScreen = document.querySelector("#login-screen");
const loadingScreen = document.querySelector("#loading-screen");
const setupScreen = document.querySelector("#setup-screen");
const album = document.querySelector("#album");
const loginMessage = document.querySelector("#login-message");
const loginForm = document.querySelector("#login-form");
const registrationToggle = document.querySelector("#registration-toggle");
const activeSubscriptions = [];
let registrationMode = false;

function showScreen(screen) {
  for (const candidate of [loginScreen, loadingScreen, setupScreen, album]) {
    candidate.hidden = candidate !== screen;
  }
}

function showError(element, error) {
  console.error(error);
  const messages = {
    "auth/email-already-in-use": "Esiste già un account con questa email. Prova ad accedere.",
    "auth/invalid-credential": "Email o password non corrette.",
    "auth/invalid-email": "L’indirizzo email non è valido.",
    "auth/network-request-failed": "Connessione non disponibile. Controlla internet e riprova.",
    "auth/operation-not-allowed": "L’accesso email/password non è ancora attivo in Firebase.",
    "auth/too-many-requests": "Troppi tentativi. Aspetta qualche minuto e riprova.",
    "auth/weak-password": "Scegli una password di almeno 6 caratteri.",
    "permission-denied": "Firebase ha negato l’accesso. Verifica l’email, l’autorizzazione e le regole del database.",
    "unavailable": "Il database non è raggiungibile. Verifica che Firestore sia stato attivato.",
  };
  element.textContent = messages[error.code] || error.message || "Si è verificato un errore. Riprova.";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  loginMessage.textContent = "";

  try {
    const email = form.querySelector("#email").value.trim();
    const password = form.querySelector("#password").value;
    if (registrationMode) {
      if (password.length < 6) {
        throw new Error("Scegli una password di almeno 6 caratteri.");
      }
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const actionCodeSettings = import.meta.env.BASE_URL === "/"
        ? undefined
        : { url: new URL(import.meta.env.BASE_URL, window.location.origin).toString() };
      await sendEmailVerification(credential.user, actionCodeSettings);
      await signOut(auth);
      loginMessage.textContent = "Account creato. Controlla la tua email e verifica l’indirizzo prima di accedere.";
      form.reset();
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showError(loginMessage, error);
  } finally {
    button.disabled = false;
  }
});

registrationToggle.addEventListener("click", () => {
  registrationMode = !registrationMode;
  loginForm.querySelector("button[type=submit]").innerHTML = registrationMode
    ? "Crea account <span aria-hidden=\"true\">↗</span>"
    : "Entra <span aria-hidden=\"true\">↗</span>";
  registrationToggle.textContent = registrationMode
    ? "Hai già un account? Accedi."
    : "È il tuo primo accesso? Crea un account.";
  loginMessage.textContent = registrationMode
    ? "Serve verificare l’email; solo gli account autorizzati potranno vedere i ricordi."
    : "";
});

document.querySelector("#signout-button").addEventListener("click", () => signOut(auth));
document.querySelector("#setup-signout").addEventListener("click", () => signOut(auth));

document.querySelector("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#setup-message");
  const button = form.querySelector("button[type=submit]");
  const file = form.querySelector("#seed-file").files[0];
  if (!file) return;

  button.disabled = true;
  message.textContent = "";

  try {
    const seed = validateSeed(JSON.parse(await file.text()));
    const albumRef = doc(db, "album", "content");
    const existing = await getDoc(albumRef);
    if (existing.exists()) throw new Error("L’album è già stato inizializzato.");

    const batch = writeBatch(db);
    batch.set(albumRef, { ...seed.album, initialized: true, createdAt: serverTimestamp() });
    for (const [collectionName, entries] of Object.entries({
      memories: seed.memories,
      phrases: seed.phrases,
      wishes: seed.wishes,
    })) {
      for (const [position, entry] of entries.entries()) {
        batch.set(doc(collection(db, collectionName)), {
          ...entry,
          position,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
      }
    }
    await batch.commit();
    openAlbum(seed.album);
  } catch (error) {
    showError(message, error);
    button.disabled = false;
  }
});

function validateSeed(seed) {
  if (!seed || typeof seed !== "object" || !seed.album || !Array.isArray(seed.memories)
    || !Array.isArray(seed.phrases) || !Array.isArray(seed.wishes)) {
    throw new Error("Il file selezionato non ha il formato previsto.");
  }
  return seed;
}

async function addOwnedEntry(collectionName, data) {
  await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser.uid,
  });
}

function clearSubscriptions() {
  activeSubscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
}

onAuthStateChanged(auth, async (user) => {
  clearSubscriptions();
  if (!user) {
    showScreen(loginScreen);
    return;
  }

  showScreen(loadingScreen);
  document.querySelector("#loading-message").textContent = "Verifico l’accesso e carico i ricordi.";
  try {
    if (!user.emailVerified) {
      await signOut(auth);
      throw new Error("Verifica l’indirizzo email prima di accedere all’album.");
    }

    const albumSnapshot = await getDoc(doc(db, "album", "content"));
    if (!albumSnapshot.exists()) {
      showScreen(setupScreen);
      return;
    }

    openAlbum(albumSnapshot.data());
  } catch (error) {
    showScreen(loginScreen);
    showError(loginMessage, error);
  }
});

function openAlbum(content) {
  renderAlbum(content);
  showScreen(album);
  listenForEntries("memories", "#memories-list", renderMemory);
  listenForEntries("phrases", "#phrases-list", renderSimpleEntry);
  listenForEntries("wishes", "#wishes-list", renderSimpleEntry);
  observeReveals();
}

function renderAlbum(content) {
  const title = document.querySelector("#album-title");
  const titleParts = String(content.title || "").split(". ");
  if (titleParts.length > 1) {
    const accent = document.createElement("span");
    accent.textContent = titleParts.slice(1).join(". ");
    title.replaceChildren(document.createTextNode(`${titleParts[0]}.\n`), accent);
  } else {
    title.textContent = content.title || "";
  }
  setText("#album-hero-eyebrow", content.heroEyebrow);
  setText("#album-intro", content.intro);
  setText("#album-dedication", content.dedication);
  setText("#album-milestone", content.milestone);
  setText("#album-wishes-intro", content.wishesIntro);
  setText("#wishes-dialog-intro", content.wishesIntro);
  renderParagraphs("#album-little-things", content.littleThings);
  renderParagraphs("#album-apology", content.apology);
  setText("#album-apology-title", content.apologyTitle);
  setText("#album-pet-eyebrow", content.petEyebrow);
  setText("#album-pet-title", content.petTitle);
  setText("#album-pet-contract", content.petContract);
  setText("#album-song", content.songTitle || content.song);
  setText("#album-song-artist", content.songArtist);
  setText("#album-song-note", content.songNote);
  setText("#christmas-title", content.christmasTitle);
  setText("#christmas-card-title", content.christmasCardTitle);
  setText("#christmas-card-copy", content.christmasCardCopy);
  setText("#album-christmas", content.christmas);
  const closingParts = String(content.closingTitle || "").split(" è ");
  const closingTitle = document.querySelector("#album-closing-title");
  if (closingParts.length > 1) {
    const accent = document.createElement("span");
    accent.textContent = `è ${closingParts.slice(1).join(" è ")}`;
    closingTitle.replaceChildren(document.createTextNode(`${closingParts[0]}\n`), accent);
  } else {
    closingTitle.textContent = content.closingTitle || "";
  }
  setText("#album-closing-note", content.closingNote);

  const words = document.querySelector("#code-words");
  words.replaceChildren(...(Array.isArray(content.codeWords) ? content.codeWords : [])
    .map((word) => {
      const item = document.createElement("li");
      item.textContent = word;
      return item;
    }));
}

function renderParagraphs(selector, value) {
    const target = document.querySelector(selector);
    const paragraphs = typeof value === "string" ? value.split(/\n{2,}/).filter(Boolean) : [];
    target.replaceChildren(...paragraphs.map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
}

function setText(selector, value) {
  document.querySelector(selector).textContent = typeof value === "string" ? value : "";
}

function listenForEntries(collectionName, selector, renderEntry) {
  const target = document.querySelector(selector);
  const unsubscribe = onSnapshot(collection(db, collectionName), (snapshot) => {
    const entries = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
        .sort((first, second) => (first.position ?? first.createdAt?.toMillis?.() ?? 0)
          - (second.position ?? second.createdAt?.toMillis?.() ?? 0));
    target.replaceChildren(...entries.map((entry) => renderEntry(entry, collectionName)));
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Questa pagina è ancora da riempire.";
      target.append(empty);
    }
      if (collectionName === "wishes") {
        const count = entries.length;
        setText("#wishes-count", `${count} ${count === 1 ? "desiderio" : "desideri"} custoditi`);
      }
      if (collectionName === "memories") renderPhotoMenu(entries);
      observeReveals(target.querySelectorAll(".reveal"));
  }, (error) => showError(target, error));
  activeSubscriptions.push(unsubscribe);
}

function renderMemory(entry) {
  const card = document.createElement("article");
    card.className = "timeline-card reveal";
  if (entry.date) {
    const date = document.createElement("span");
      date.className = "timeline-date";
    date.textContent = entry.date;
    card.append(date);
  }
    const mark = document.createElement("div");
    mark.className = "timeline-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "♡";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "un ricordo nostro";
  const title = document.createElement("h3");
  title.textContent = entry.title;
  const text = document.createElement("p");
  text.textContent = entry.text;
    card.append(mark, eyebrow, title, text, createDeleteButton("memories", entry));
  return card;
}

function renderSimpleEntry(entry, collectionName) {
  const card = document.createElement("article");
  card.className = "entry-card";
  const text = document.createElement("p");
  text.textContent = entry.text;
  card.append(text, createDeleteButton(collectionName, entry));
  return card;
}

function renderPhotoMenu(entries) {
  const target = document.querySelector("#photo-menu");
  target.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "photo-menu-note";
    empty.textContent = "I primi ricordi fotografici arriveranno qui.";
    target.append(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "photo-menu-item";
    const date = document.createElement("span");
    date.className = "photo-menu-date";
    date.textContent = entry.date || "Data da aggiungere";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const note = document.createElement("span");
    note.className = "photo-menu-empty";
    note.textContent = "La foto potrà essere aggiunta quando attiveremo l’archiviazione.";
    item.append(date, title, note);
    target.append(item);
  }
}

function createDeleteButton(collectionName, entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-delete";
  button.textContent = "Rimuovi";
  button.setAttribute("aria-label", "Rimuovi questo contenuto");
  button.addEventListener("click", async () => {
    if (!window.confirm("Vuoi rimuovere questo contenuto dall’album? Non potrai recuperarlo.")) return;
    button.disabled = true;
    try {
      await deleteDoc(doc(db, collectionName, entry.id));
    } catch (error) {
      showError(button.parentElement, error);
      button.disabled = false;
    }
  });
  return button;
}

function bindEntryForm(formSelector, collectionName, fields) {
  const form = document.querySelector(formSelector);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const message = form.querySelector(".form-message");
    const formData = new FormData(form);
    const content = Object.fromEntries(fields.map((field) => [field, String(formData.get(field) ?? "").trim()]));
    button.disabled = true;
    message.textContent = "";
    try {
      await addOwnedEntry(collectionName, { ...content, position: Date.now() });
      form.reset();
      form.closest("details")?.removeAttribute("open");
    } catch (error) {
      showError(message, error);
    } finally {
      button.disabled = false;
    }
  });
}

bindEntryForm("#memory-form", "memories", ["date", "title", "text"]);
bindEntryForm("#phrase-form", "phrases", ["text"]);
bindEntryForm("#wish-form", "wishes", ["text"]);

document.querySelectorAll("[data-open-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.openDialog).showModal());
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelectorAll(".modal").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

let revealObserver;
function observeReveals(elements = document.querySelectorAll(".reveal")) {
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
        else entry.target.classList.remove("is-visible");
      });
    }, { threshold: 0.16 });
  }
  elements.forEach((element) => revealObserver.observe(element));
}
