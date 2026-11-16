// Spese Casa — spese di casa condivise, sincronizzate con Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, onSnapshot,
  addDoc, updateDoc, deleteDoc, setDoc, getDoc, doc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Configurazione pubblica del progetto: l'accesso ai dati e' protetto dalle regole di Firestore
const firebaseConfig = {
  apiKey: "AIzaSyCMu8QSDWG1eV3S38vdw79ZCQX2wGq2jUM",
  // Il login passa dallo stesso dominio dell'app (vedi web/__/auth), necessario per i browser che bloccano i cookie di terze parti
  authDomain: "lelux95.github.io/spese-casa",
  projectId: "spese-casa-d4f28",
  storageBucket: "spese-casa-d4f28.firebasestorage.app",
  messagingSenderId: "878816165732",
  appId: "1:878816165732:web:1577afd71c619d5e5d0471",
};
const OWNER = "daniele95delfrate@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "it";
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const C_SPESE = collection(db, "spese");
const C_RIC = collection(db, "ricorrenti");
const C_CAT = collection(db, "categorie");
const C_RISP = collection(db, "risparmi");
const D_IMP = doc(db, "impostazioni", "generali");
const D_MEMBRI = doc(db, "config", "membri");

const CATEGORIE_BASE = [
  { id: "energia", nome: "Energia", icona: "⚡", colore: "#f2b84b", ordine: 1, unita: "kWh" },
  { id: "gas", nome: "Gas", icona: "🔥", colore: "#ff8a3d", ordine: 2, unita: "mc" },
  { id: "acqua", nome: "Acqua", icona: "💧", colore: "#4fc3f7", ordine: 3, unita: "mc" },
  { id: "telefono", nome: "Telefono e Internet", icona: "📶", colore: "#7e8cf2", ordine: 4 },
  { id: "abbonamenti", nome: "Abbonamenti", icona: "📺", colore: "#e56fb0", ordine: 5 },
  { id: "assicurazioni", nome: "Assicurazioni", icona: "🛡️", colore: "#9c7cf0", ordine: 6 },
  { id: "mutuo", nome: "Mutuo", icona: "🏠", colore: "#3dd68c", ordine: 7 },
  { id: "auto", nome: "Auto", icona: "🚗", colore: "#5fb3a8", ordine: 8 },
  { id: "spesa", nome: "Spesa alimentare", icona: "🛒", colore: "#a3c95a", ordine: 9 },
  { id: "manutenzione", nome: "Casa e manutenzione", icona: "🔧", colore: "#c9a27a", ordine: 10 },
  { id: "altro", nome: "Altro", icona: "📦", colore: "#9ba5a0", ordine: 99 },
];
const FREQ = { 1: "Mensile", 2: "Bimestrale", 3: "Trimestrale", 6: "Semestrale", 12: "Annuale" };
const GIORNI_AVVISO = 15;

// ---------- Utilità ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = Number(String(v ?? "").trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const eur = (n) => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const eur0 = (n) => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MESI_B = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const fmtDate = (s) => { const d = parseIso(s); return `${d.getDate()} ${MESI_B[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDay = (s) => parseIso(s).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const ym = (s) => s.slice(0, 7);
const ymAdd = (y, m, delta) => { const d = new Date(y, m - 1 + delta, 1); return [d.getFullYear(), d.getMonth() + 1]; };
// Aggiunge mesi mantenendo il giorno scelto (es. 31 -> fine mese)
function addMonths(dateStr, months, giorno) {
  const d = parseIso(dateStr);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(giorno || d.getDate(), last));
  return iso(target);
}

// ---------- Stato ----------
let user = null;
let spese = [];
let ricorrenti = [];
let categorie = [];
let impostazioni = { conti: ["Revolut", "BCC"] };
let membri = [];
let risparmi = [];
const loaded = { spese: false, ric: false, cat: false, risp: false };
let unsubs = [];
let tab = "home";
const filtro = { y: new Date().getFullYear(), m: new Date().getMonth() + 1, cat: null, q: "" };
const riep = { mode: "mese", y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
const isOwner = () => user && user.email === OWNER;

const catById = (id) => categorie.find((c) => c.id === id) || { id, nome: id || "Senza categoria", icona: "❔", colore: "#9ba5a0" };
const catsOrdinate = () => [...categorie].sort((a, b) => (a.ordine ?? 50) - (b.ordine ?? 50) || a.nome.localeCompare(b.nome));

// ---------- Tema ----------
const applyTheme = () => {
  const light = localStorage.getItem("tema") === "chiaro";
  document.documentElement.classList.toggle("light", light);
  document.querySelector('meta[name="theme-color"]').content = light ? "#f4f6f5" : "#111413";
};
applyTheme();

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- Accesso ----------
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

$("#btn-login").addEventListener("click", async () => {
  $("#login-error").textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user") {
      $("#login-error").textContent = "Accesso non riuscito: " + (e.code || e.message);
    }
  }
});
getRedirectResult(auth).catch((e) => { $("#login-error").textContent = "Accesso non riuscito: " + (e.code || e.message); });
$("#btn-denied-out").addEventListener("click", () => signOut(auth));

function show(section) {
  for (const id of ["login", "denied", "main"]) $("#" + id).classList.toggle("hidden", id !== section);
}

onAuthStateChanged(auth, (u) => {
  user = u;
  unsubs.forEach((f) => f());
  unsubs = [];
  closeSheet();
  if (!u) { show("login"); return; }
  const av = $("#btn-account");
  av.textContent = u.photoURL ? "" : (u.displayName || u.email || "?").slice(0, 1).toUpperCase();
  av.style.backgroundImage = u.photoURL ? `url("${u.photoURL}")` : "";
  show("main");
  listen();
});

function onErr(err) {
  if (err.code === "permission-denied") {
    $("#denied-email").textContent = user?.email || "";
    show("denied");
  } else {
    $("#sync").textContent = "Errore: " + err.code;
  }
}

function listen() {
  unsubs.push(onSnapshot(C_SPESE, { includeMetadataChanges: true }, (snap) => {
    spese = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loaded.spese = true;
    const p = snap.metadata.hasPendingWrites, c = snap.metadata.fromCache;
    $("#sync").textContent = p ? "Modifiche in attesa di rete…" : c ? "Offline · dati salvati sul telefono" : "Sincronizzato";
    render();
  }, onErr));
  unsubs.push(onSnapshot(C_RIC, (snap) => {
    ricorrenti = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loaded.ric = true;
    render();
    elaboraAutomatiche();
  }, onErr));
  unsubs.push(onSnapshot(C_CAT, (snap) => {
    categorie = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loaded.cat = true;
    if (!categorie.length && !snap.metadata.fromCache) creaCategorieBase();
    render();
  }, onErr));
  unsubs.push(onSnapshot(C_RISP, (snap) => {
    risparmi = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loaded.risp = true;
    render();
  }, onErr));
  unsubs.push(onSnapshot(D_IMP, (s) => { if (s.exists()) impostazioni = { conti: ["Revolut", "BCC"], ...s.data() }; }, () => {}));
  unsubs.push(onSnapshot(D_MEMBRI, (s) => { membri = s.exists() ? (s.data().emails || []) : []; }, () => {}));
}

async function creaCategorieBase() {
  const b = writeBatch(db);
  for (const c of CATEGORIE_BASE) { const { id, ...rest } = c; b.set(doc(C_CAT, id), rest); }
  b.set(D_IMP, { conti: ["Revolut", "BCC"] }, { merge: true });
  await b.commit().catch(() => {});
}

// ---------- Ricorrenti: inserimento automatico ----------
let elaborando = false;
async function elaboraAutomatiche() {
  if (elaborando || !loaded.ric) return;
  elaborando = true;
  try {
    const oggi = today();
    let nuove = 0;
    for (const r of ricorrenti) {
      if (!r.attiva || !r.automatica || !haImporto(r) || !r.prossima || r.prossima > oggi) continue;
      let data = r.prossima;
      let giri = 0;
      while (data <= oggi && giri < 36) {
        const ref = doc(C_SPESE, `ric_${r.id}_${data}`);
        const ex = await getDoc(ref).catch(() => null);
        if (!ex || !ex.exists()) {
          await setDoc(ref, nuovaSpesaDaRicorrente(r, data, r.importo));
          nuove++;
        }
        data = addMonths(data, r.frequenza || 1, r.giorno);
        giri++;
      }
      await updateDoc(doc(C_RIC, r.id), { prossima: data });
    }
    if (nuove) toast(`${nuove} ${nuove === 1 ? "spesa ricorrente registrata" : "spese ricorrenti registrate"} in automatico`);
  } catch (e) {
    console.warn("Ricorrenti", e);
  } finally {
    elaborando = false;
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && user) { elaboraAutomatiche(); render(); } });

function nuovaSpesaDaRicorrente(r, data, importo) {
  return {
    data, importo: Number(importo) || 0, categoria: r.categoria || "altro", descrizione: r.nome || "",
    conto: r.conto || "", note: "", ricorrenteId: r.id, creataDa: user?.email || "", creataIl: serverTimestamp(),
  };
}

// ---------- Rendering ----------
document.querySelectorAll(".bottomnav button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
$("#fab").addEventListener("click", () => (tab === "risparmi" ? apriVersamento() : apriSpesa()));
$("#btn-account").addEventListener("click", apriImpostazioni);

function render() {
  if (!user) return;
  document.querySelectorAll(".bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#page-title").textContent = { home: "Spese Casa", spese: "Spese", riepilogo: "Riepilogo", ricorrenti: "Ricorrenti", risparmi: "Risparmi" }[tab];
  $("#fab").setAttribute("aria-label", tab === "risparmi" ? "Nuovo versamento" : "Nuova spesa");
  const v = $("#view");
  if (!loaded.spese || !loaded.cat) { v.innerHTML = `<div class="empty">Caricamento…</div>`; return; }
  if (tab === "home") v.innerHTML = viewHome();
  if (tab === "spese") v.innerHTML = viewSpese();
  if (tab === "riepilogo") v.innerHTML = viewRiepilogo();
  if (tab === "ricorrenti") v.innerHTML = viewRicorrenti();
  if (tab === "risparmi") v.innerHTML = viewRisparmi();
}

const haImporto = (r) => r.importo !== null && r.importo !== undefined && r.importo !== "" && Number(r.importo) > 0;
const totale = (arr) => arr.reduce((s, x) => s + (Number(x.importo) || 0), 0);
const speseMese = (y, m) => spese.filter((s) => ym(s.data) === `${y}-${pad(m)}`);
const speseAnno = (y) => spese.filter((s) => s.data.startsWith(`${y}-`));

function itemSpesa(s, showDate = false) {
  const c = catById(s.categoria);
  const sub = [showDate ? fmtDate(s.data) : null, c.nome, s.conto, s.consumo ? `${String(s.consumo).replace(".", ",")} ${c.unita || ""}` : null].filter(Boolean).join(" · ");
  return `<div class="item" data-spesa="${esc(s.id)}">
    <div class="ico" style="background:${esc(c.colore)}22">${esc(c.icona)}</div>
    <div class="txt"><div class="t">${esc(s.descrizione || c.nome)}${s.ricorrenteId ? ' <span class="badge">🔁</span>' : ""}</div><div class="s">${esc(sub)}</div></div>
    <div class="amt">${eur(s.importo)}</div></div>`;
}

function scadenze() {
  const oggi = today();
  return ricorrenti
    .filter((r) => r.attiva && r.prossima && daysBetween(oggi, r.prossima) <= GIORNI_AVVISO)
    .sort((a, b) => a.prossima.localeCompare(b.prossima));
}

function viewHome() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const tot = totale(speseMese(y, m));
  const oggi = today();

  const sc = scadenze();
  const daPagare = sc.filter((r) => !r.automatica);
  const scHtml = sc.length ? sc.map((r) => {
    const c = catById(r.categoria);
    const gg = daysBetween(oggi, r.prossima);
    const quando = gg < 0 ? `<span class="badge late">scaduta da ${-gg} gg</span>` : gg === 0 ? `<span class="badge warn">oggi</span>` : `<span class="badge${gg <= 3 ? " warn" : ""}">tra ${gg} gg</span>`;
    const acts = r.automatica
      ? `<span class="badge auto">addebito automatico</span>`
      : `<div class="acts"><button class="btn sm primary" data-paga="${esc(r.id)}">${haImporto(r) ? "Pagata" : "Registra"}</button><button class="btn sm" data-salta="${esc(r.id)}">Salta</button></div>`;
    return `<div class="due">
      <div class="ico" style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:${esc(c.colore)}22">${esc(c.icona)}</div>
      <div class="grow" style="min-width:0"><div style="font-weight:650">${esc(r.nome)}</div>
        <div class="small muted">${fmtDate(r.prossima)} · ${haImporto(r) ? eur(r.importo) : "importo da fattura"} ${quando}</div></div>
      ${acts}</div>`;
  }).join("") : `<div class="empty">Nessuna scadenza nei prossimi ${GIORNI_AVVISO} giorni 🎉</div>`;

  // Per categoria nel mese
  const perCat = raggruppa(speseMese(y, m));
  const max = Math.max(1, ...perCat.map((x) => x.tot));
  const catHtml = perCat.length ? perCat.slice(0, 6).map((x) => `
    <div class="cat-row" data-cat="${esc(x.cat.id)}">
      <div class="row between"><span>${esc(x.cat.icona)} ${esc(x.cat.nome)}</span><b>${eur(x.tot)}</b></div>
      <div class="bar"><i style="width:${(x.tot / max) * 100}%;background:${esc(x.cat.colore)}"></i></div></div>`).join("")
    : `<div class="empty">Nessuna spesa questo mese</div>`;

  const ultime = [...spese].sort((a, b) => b.data.localeCompare(a.data) || (b.creataIl?.seconds || 0) - (a.creataIl?.seconds || 0)).slice(0, 5);

  return `
    <div class="card">
      <h3>Speso a ${MESI[m - 1]}</h3>
      <div class="big-total">${eur(tot)}</div>
      ${previsteHtml(y, m, tot)}
    </div>
    <div class="card">
      <h3>In scadenza${daPagare.length ? `<span class="count">${daPagare.length}</span>` : ""}</h3>
      ${scHtml}
    </div>
    <div class="card">
      <h3>Per categoria · ${MESI[m - 1]}</h3>
      ${catHtml}
    </div>
    <div class="card">
      <div class="row between"><h3 style="margin:0">Ultime spese</h3><button class="linkbtn" data-goto="spese">Vedi tutte</button></div>
      <div class="list">${ultime.length ? ultime.map((s) => itemSpesa(s, true)).join("") : `<div class="empty">Ancora nessuna spesa. Tocca + per aggiungerne una.</div>`}</div>
    </div>`;
}

// Spese ricorrenti ancora previste da oggi a fine mese (non ancora registrate)
function previsteHtml(y, m, tot) {
  const oggi = today();
  const fine = iso(new Date(y, m, 0));
  const voci = [];
  let bollette = 0;
  for (const r of ricorrenti) {
    if (!r.attiva || !r.prossima) continue;
    let d = r.prossima, giri = 0;
    while (d <= fine && giri < 40) {
      // Le automatiche gia' passate vengono registrate da sole: contano solo quelle future
      if (!(r.automatica && d <= oggi)) {
        if (haImporto(r)) voci.push({ nome: r.nome, importo: Number(r.importo), data: d });
        else bollette++;
      }
      d = addMonths(d, r.frequenza || 1, r.giorno);
      giri++;
    }
  }
  if (!voci.length && !bollette) return `<div class="small muted" style="margin-top:6px">Nessun'altra spesa ricorrente prevista entro fine mese</div>`;
  voci.sort((a, b) => a.data.localeCompare(b.data));
  const prev = voci.reduce((s, v) => s + v.importo, 0);
  const elenco = voci.map((v) => `${esc(v.nome)} ${eur(v.importo)}`).join(" · ");
  const boll = bollette ? `${voci.length ? " · " : ""}+ ${bollette} ${bollette === 1 ? "bolletta" : "bollette"} da fattura` : "";
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
    <div class="row between"><span class="muted">Ancora previste entro il ${fmtDate(fine)}</span><b>${eur(prev)}</b></div>
    <div class="small muted" style="margin-top:4px">${elenco}${boll}</div>
    <div class="row between" style="margin-top:8px"><span class="muted">Totale stimato a fine mese</span><b>${eur(tot + prev)}${bollette ? " +" : ""}</b></div>
  </div>`;
}

function raggruppa(arr) {
  const map = new Map();
  for (const s of arr) map.set(s.categoria, (map.get(s.categoria) || 0) + (Number(s.importo) || 0));
  return [...map.entries()].map(([id, tot]) => ({ cat: catById(id), tot })).sort((a, b) => b.tot - a.tot);
}

function viewSpese() {
  let arr = filtro.m ? speseMese(filtro.y, filtro.m) : speseAnno(filtro.y);
  if (filtro.cat) arr = arr.filter((s) => s.categoria === filtro.cat);
  const q = filtro.q.trim().toLowerCase();
  if (q) arr = arr.filter((s) => `${s.descrizione} ${s.note} ${catById(s.categoria).nome} ${s.conto}`.toLowerCase().includes(q));
  arr.sort((a, b) => b.data.localeCompare(a.data));
  const label = filtro.m ? `${MESI[filtro.m - 1]} ${filtro.y}` : `Anno ${filtro.y}`;
  let html = `
    <div class="period"><button data-fnav="-1">‹</button><span class="lbl">${label}</span><button data-fnav="1">›</button></div>
    <div class="seg"><button data-fmode="mese" class="${filtro.m ? "active" : ""}">Mese</button><button data-fmode="anno" class="${filtro.m ? "" : "active"}">Anno</button></div>
    <input class="search" id="q" type="search" placeholder="Cerca…" value="${esc(filtro.q)}">
    <div class="chips"><button class="chip ${filtro.cat ? "" : "active"}" data-fcat="">Tutte</button>
      ${catsOrdinate().map((c) => `<button class="chip ${filtro.cat === c.id ? "active" : ""}" data-fcat="${esc(c.id)}">${esc(c.icona)} ${esc(c.nome)}</button>`).join("")}</div>
    <div class="card"><div class="row between"><span class="muted">${arr.length} ${arr.length === 1 ? "spesa" : "spese"}</span><b style="font-size:20px">${eur(totale(arr))}</b></div>`;
  if (!arr.length) html += `<div class="empty">Nessuna spesa in questo periodo</div>`;
  let lastDay = "";
  for (const s of arr) {
    if (s.data !== lastDay) { html += `<div class="day-head">${fmtDay(s.data)}</div>`; lastDay = s.data; }
    html += itemSpesa(s);
  }
  return html + `</div>`;
}

function viewRiepilogo() {
  const isMese = riep.mode === "mese";
  const arr = isMese ? speseMese(riep.y, riep.m) : speseAnno(riep.y);
  const [py, pm] = isMese ? ymAdd(riep.y, riep.m, -1) : [riep.y - 1, null];
  const prev = isMese ? speseMese(py, pm) : speseAnno(py);
  const tot = totale(arr), totPrev = totale(prev);
  const per = raggruppa(arr);
  const prevMap = new Map(raggruppa(prev).map((x) => [x.cat.id, x.tot]));
  // Categorie presenti solo nel periodo precedente
  for (const [id, t] of prevMap) if (!per.find((x) => x.cat.id === id)) per.push({ cat: catById(id), tot: 0 });
  const max = Math.max(1, ...per.map((x) => x.tot));
  const label = isMese ? `${MESI[riep.m - 1]} ${riep.y}` : `Anno ${riep.y}`;
  const prevLbl = isMese ? `${MESI_B[pm - 1]} ${py}` : `${py}`;
  const dTot = totPrev ? ((tot - totPrev) / totPrev) * 100 : null;

  let mesiHtml = "";
  if (!isMese) {
    const vals = MESI_B.map((_, i) => totale(speseMese(riep.y, i + 1)));
    const mx = Math.max(1, ...vals);
    const now = new Date();
    mesiHtml = `<div class="card"><h3>Mese per mese</h3><div class="months">${vals.map((v, i) => `
      <div class="m ${riep.y === now.getFullYear() && i === now.getMonth() ? "cur" : ""}" data-rmese="${i + 1}" title="${eur(v)}">
        <i style="height:${(v / mx) * 100}%"></i><span>${MESI_B[i].slice(0, 1).toUpperCase()}</span></div>`).join("")}</div>
      <div class="small muted" style="margin-top:8px">Media mensile ${eur(tot / (riep.y === now.getFullYear() ? now.getMonth() + 1 : 12))} · tocca un mese per il dettaglio</div></div>`;
  }

  return `
    <div class="seg"><button data-rmode="mese" class="${isMese ? "active" : ""}">Mese</button><button data-rmode="anno" class="${isMese ? "" : "active"}">Anno</button></div>
    <div class="period"><button data-rnav="-1">‹</button><span class="lbl">${label}</span><button data-rnav="1">›</button></div>
    <div class="card">
      <h3>Totale</h3><div class="big-total">${eur(tot)}</div>
      <div class="small muted">${prevLbl}: ${eur(totPrev)}${dTot !== null ? ` · <span class="${dTot > 0 ? "neg" : "pos"}">${dTot > 0 ? "+" : ""}${dTot.toFixed(0)}%</span>` : ""}</div>
    </div>
    ${mesiHtml}
    <div class="card"><h3>Per categoria</h3>
      ${per.length ? per.map((x) => {
        const p = prevMap.get(x.cat.id) || 0;
        const d = x.tot - p;
        const isAbb = x.cat.id === "abbonamenti";
        return `<div class="cat-row" ${isAbb ? 'data-abbtoggle="1"' : `data-rcat="${esc(x.cat.id)}"`}>
          <div class="row between"><span>${esc(x.cat.icona)} ${esc(x.cat.nome)}</span><b>${eur(x.tot)}</b></div>
          <div class="bar"><i style="width:${(x.tot / max) * 100}%;background:${esc(x.cat.colore)}"></i></div>
          <div class="row between small muted" style="margin-top:4px"><span>${tot ? ((x.tot / tot) * 100).toFixed(1) : 0}% del totale</span>
          <span>${prevLbl}: ${eur(p)} ${p || x.tot ? `<span class="${d > 0 ? "neg" : d < 0 ? "pos" : ""}">(${d > 0 ? "+" : ""}${eur0(d)})</span>` : ""}</span></div>
          ${isAbb ? `<div class="small" style="margin-top:6px;color:var(--accent);font-weight:700">${riep.abbAperto ? "▲ Nascondi dettaglio" : "▼ Dettaglio abbonamenti e costo annuo"}</div>` : ""}</div>
          ${isAbb && riep.abbAperto ? dettaglioAbbonamenti(arr, label) : ""}`;
      }).join("") : `<div class="empty">Nessuna spesa in questo periodo</div>`}
    </div>`;
}

// Dettaglio per abbonamento: speso nel periodo, prezzo attuale e costo annuo
function dettaglioAbbonamenti(arrPeriodo, label) {
  const ricAbb = ricorrenti.filter((r) => r.categoria === "abbonamenti");
  const chiave = (s) => {
    if (s.ricorrenteId) { const r = ricorrenti.find((x) => x.id === s.ricorrenteId); if (r) return r.nome; }
    const d = (s.descrizione || "Altro").trim();
    const r = ricAbb.find((x) => d.toLowerCase().startsWith(x.nome.toLowerCase()));
    return r ? r.nome : d;
  };
  const oggi = today();
  const unAnnoFa = iso(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
  const gruppi = new Map();
  const g = (k) => { if (!gruppi.has(k)) gruppi.set(k, { nome: k, periodo: 0, ultimi12: 0, ric: ricAbb.find((r) => r.nome === k) }); return gruppi.get(k); };
  for (const r of ricAbb) if (r.attiva) g(r.nome);
  for (const s of spese) {
    if (s.categoria !== "abbonamenti") continue;
    const x = g(chiave(s));
    if (s.data > unAnnoFa && s.data <= oggi) x.ultimi12 += Number(s.importo) || 0;
  }
  for (const s of arrPeriodo) if (s.categoria === "abbonamenti") g(chiave(s)).periodo += Number(s.importo) || 0;
  const righe = [...gruppi.values()].map((x) => {
    const attivo = x.ric && x.ric.attiva && haImporto(x.ric);
    const annuo = attivo ? (Number(x.ric.importo) * 12) / (x.ric.frequenza || 1) : x.ultimi12;
    const prezzo = attivo ? `${eur(x.ric.importo)} ${x.ric.frequenza === 12 ? "/anno" : x.ric.frequenza === 1 ? "/mese" : "ogni " + x.ric.frequenza + " mesi"}` : "non ricorrente";
    return { ...x, annuo, prezzo };
  }).sort((a, b) => b.annuo - a.annuo);
  const totAnnuo = righe.reduce((s, x) => s + x.annuo, 0);
  const max = Math.max(1, ...righe.map((x) => x.annuo));
  return `<div style="background:var(--surface2);border-radius:14px;padding:4px 12px;margin:4px 0 8px">
    ${righe.map((x) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)">
      <div class="row between"><b>${esc(x.nome)}</b><b>${eur(x.annuo)}<span class="muted small" style="font-weight:600"> /anno</span></b></div>
      <div class="bar"><i style="width:${(x.annuo / max) * 100}%;background:#e56fb0"></i></div>
      <div class="row between small muted" style="margin-top:4px"><span>${esc(x.prezzo)}</span><span>${label}: ${eur(x.periodo)}</span></div></div>`).join("")}
    <div class="row between" style="padding:10px 0"><span class="muted">Totale abbonamenti all'anno</span><b>${eur(totAnnuo)}</b></div>
    <button class="linkbtn" data-rcat="abbonamenti">Vedi le singole spese ›</button>
  </div>`;
}

function viewRicorrenti() {
  const arr = [...ricorrenti].sort((a, b) => (b.attiva - a.attiva) || (a.prossima || "").localeCompare(b.prossima || ""));
  const mensile = arr.filter((r) => r.attiva && haImporto(r)).reduce((s, r) => s + (Number(r.importo) || 0) / (r.frequenza || 1), 0);
  return `
    <button class="linkbtn" data-back-imp="1">‹ Impostazioni</button>
    <div class="card">
      <h3>Costo ricorrente stimato</h3>
      <div class="big-total">${eur(mensile)}<span class="muted" style="font-size:16px;font-weight:600"> / mese</span></div>
      <div class="small muted">${eur(mensile * 12)} l'anno, escluse le bollette a importo variabile · le spese automatiche si registrano da sole, le altre le confermi tu da Home</div>
    </div>
    <button class="btn primary block" id="btn-new-ric">+ Nuova spesa ricorrente</button>
    ${[["Spese fisse", (r) => haImporto(r) && r.categoria !== "abbonamenti"], ["Abbonamenti", (r) => haImporto(r) && r.categoria === "abbonamenti"], ["Bollette · promemoria", (r) => !haImporto(r)]]
      .map(([titolo, f]) => [titolo, arr.filter(f)]).filter(([, g]) => g.length).map(([titolo, g]) => `
    <div class="card"><h3>${titolo}</h3><div class="list">
      ${g.map((r) => {
        const c = catById(r.categoria);
        return `<div class="item" data-ric="${esc(r.id)}" style="${r.attiva ? "" : "opacity:.5"}">
          <div class="ico" style="background:${esc(c.colore)}22">${esc(c.icona)}</div>
          <div class="txt"><div class="t">${esc(r.nome)}</div>
            <div class="s">${FREQ[r.frequenza] || "Ogni " + r.frequenza + " mesi"} · ${r.attiva ? "prossima " + (r.prossima ? fmtDate(r.prossima) : "—") : "in pausa"}</div>
            <div style="margin-top:3px">${r.automatica ? '<span class="badge auto">automatica</span>' : haImporto(r) ? '<span class="badge">da confermare</span>' : '<span class="badge warn">promemoria</span>'} ${r.conto ? `<span class="badge">${esc(r.conto)}</span>` : ""}</div></div>
          <div class="amt">${haImporto(r) ? eur(r.importo) : '<span class="muted small">da fattura</span>'}</div></div>`;
      }).join("")}
    </div></div>`).join("") || `<div class="card"><div class="empty">Nessuna spesa ricorrente</div></div>`}`;
}

// ---------- Risparmi ----------
const nomeDa = (email) => (!email ? "" : email === OWNER ? "Daniele" : email.split("@")[0].split(/[._]/)[0].replace(/^./, (c) => c.toUpperCase()));
const risp = { y: new Date().getFullYear() };

function viewRisparmi() {
  if (!loaded.risp) return `<div class="empty">Caricamento…</div>`;
  const tot = totale(risparmi);
  const anno = risparmi.filter((r) => r.data.startsWith(`${risp.y}-`));
  const totAnno = totale(anno);
  const now = new Date();
  const mesiAnno = risp.y === now.getFullYear() ? now.getMonth() + 1 : 12;
  const vals = MESI_B.map((_, i) => totale(anno.filter((r) => ym(r.data) === `${risp.y}-${pad(i + 1)}`)));
  const mx = Math.max(1, ...vals);
  const arr = [...anno].sort((a, b) => b.data.localeCompare(a.data));
  let lista = "", lastM = "";
  for (const r of arr) {
    const m = ym(r.data);
    if (m !== lastM) {
      const [yy, mm] = m.split("-").map(Number);
      lista += `<div class="day-head row between"><span>${MESI[mm - 1]} ${yy}</span><span>${eur(totale(arr.filter((x) => ym(x.data) === m)))}</span></div>`;
      lastM = m;
    }
    lista += `<div class="item" data-risp="${esc(r.id)}">
      <div class="ico" style="background:var(--accent-soft)">💰</div>
      <div class="txt"><div class="t">${esc(r.nota || "Versamento")}</div><div class="s">${fmtDate(r.data)}${r.creataDa ? " · " + esc(nomeDa(r.creataDa)) : ""}</div></div>
      <div class="amt pos">+${eur(r.importo)}</div></div>`;
  }
  return `
    <div class="card">
      <h3>Totale versato sul conto risparmi</h3>
      <div class="big-total">${eur(tot)}</div>
      <div class="small muted">${risparmi.length} ${risparmi.length === 1 ? "versamento" : "versamenti"} registrati</div>
    </div>
    <div class="period"><button data-snav="-1">‹</button><span class="lbl">Anno ${risp.y}</span><button data-snav="1">›</button></div>
    <div class="card">
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><span class="small muted">Versato nel ${risp.y}</span><b>${eur(totAnno)}</b></div>
        <div class="kpi"><span class="small muted">Media al mese</span><b>${eur(totAnno / mesiAnno)}</b></div>
      </div>
      <div class="months">${vals.map((v, i) => `<div class="m ${risp.y === now.getFullYear() && i === now.getMonth() ? "cur" : ""}" title="${eur(v)}"><i style="height:${(v / mx) * 100}%"></i><span>${MESI_B[i].slice(0, 1).toUpperCase()}</span></div>`).join("")}</div>
    </div>
    <div class="card"><h3>Versamenti ${risp.y}</h3>
      ${lista || `<div class="empty">Nessun versamento nel ${risp.y}. Tocca + per registrarne uno.</div>`}
    </div>`;
}

function apriVersamento(r = null) {
  const v = r || { data: today(), importo: "", nota: "" };
  openSheet(`
    <h2>${r ? "Modifica versamento" : "Nuovo versamento"}</h2>
    <p class="small muted" style="margin-top:-8px">Soldi messi sul conto risparmi.</p>
    <input id="v-imp" class="amount-input" inputmode="decimal" placeholder="0,00 €" value="${v.importo !== "" ? String(v.importo).replace(".", ",") : ""}">
    <div class="field"><label>Data</label><input id="v-data" type="date" value="${esc(v.data)}"></div>
    <div class="field"><label>Nota</label><input id="v-nota" placeholder="Es. versamento mensile, tredicesima…" value="${esc(v.nota)}"></div>
    ${r && r.creataDa ? `<p class="small muted">Registrato da ${esc(nomeDa(r.creataDa))}</p>` : ""}
    <p id="v-err" class="error"></p>
    <div class="actions">
      ${r ? `<button class="btn danger" id="v-del">Elimina</button>` : `<button class="btn" id="v-cancel">Annulla</button>`}
      <button class="btn primary" id="v-save">Salva</button>
    </div>`);
  if (!r) setTimeout(() => $("#v-imp").focus(), 50);
  $("#v-cancel")?.addEventListener("click", closeSheet);
  $("#v-del")?.addEventListener("click", async () => {
    if (!confirm("Eliminare questo versamento?")) return;
    await deleteDoc(doc(C_RISP, r.id));
    closeSheet(); toast("Versamento eliminato");
  });
  $("#v-save").addEventListener("click", async () => {
    const importo = num($("#v-imp").value);
    if (!(importo > 0)) { $("#v-err").textContent = "Inserisci un importo valido"; return; }
    const rec = { data: $("#v-data").value || today(), importo: Math.round(importo * 100) / 100, nota: $("#v-nota").value.trim() };
    closeSheet();
    if (r) await updateDoc(doc(C_RISP, r.id), { ...rec, modificataDa: user.email, modificataIl: serverTimestamp() });
    else await addDoc(C_RISP, { ...rec, creataDa: user.email, creataIl: serverTimestamp() });
    risp.y = Number(rec.data.slice(0, 4));
    toast(r ? "Versamento aggiornato" : "Versamento registrato");
  });
}

// ---------- Click nella vista ----------
$("#view").addEventListener("click", (e) => {
  const t = e.target.closest("[data-spesa],[data-paga],[data-salta],[data-cat],[data-goto],[data-fnav],[data-fmode],[data-fcat],[data-rmode],[data-rnav],[data-rcat],[data-rmese],[data-ric],[data-risp],[data-snav],[data-abbtoggle],[data-back-imp],#btn-new-ric");
  if (!t) return;
  const d = t.dataset;
  if (d.spesa) apriSpesa(spese.find((s) => s.id === d.spesa));
  else if (d.paga) pagaRicorrente(d.paga);
  else if (d.salta) saltaRicorrente(d.salta);
  else if (d.cat !== undefined && tab === "home") { const n = new Date(); Object.assign(filtro, { y: n.getFullYear(), m: n.getMonth() + 1, cat: d.cat }); tab = "spese"; render(); }
  else if (d.goto) { tab = d.goto; render(); }
  else if (d.fnav) { if (filtro.m) [filtro.y, filtro.m] = ymAdd(filtro.y, filtro.m, Number(d.fnav)); else filtro.y += Number(d.fnav); render(); }
  else if (d.fmode) { filtro.m = d.fmode === "mese" ? (filtro.y === new Date().getFullYear() ? new Date().getMonth() + 1 : 12) : null; render(); }
  else if (d.fcat !== undefined) { filtro.cat = d.fcat || null; render(); }
  else if (d.rmode) { riep.mode = d.rmode; render(); }
  else if (d.rnav) { if (riep.mode === "mese") [riep.y, riep.m] = ymAdd(riep.y, riep.m, Number(d.rnav)); else riep.y += Number(d.rnav); render(); }
  else if (d.backImp) { tab = "home"; render(); apriImpostazioni(); }
  else if (d.abbtoggle) { riep.abbAperto = !riep.abbAperto; render(); }
  else if (d.rmese) { riep.mode = "mese"; riep.m = Number(d.rmese); render(); }
  else if (d.rcat) { Object.assign(filtro, { y: riep.y, m: riep.mode === "mese" ? riep.m : null, cat: d.rcat }); tab = "spese"; render(); }
  else if (d.risp) apriVersamento(risparmi.find((r) => r.id === d.risp));
  else if (d.snav) { risp.y += Number(d.snav); render(); }
  else if (d.ric) apriRicorrente(ricorrenti.find((r) => r.id === d.ric));
  else if (t.id === "btn-new-ric") apriRicorrente();
});
$("#view").addEventListener("input", (e) => {
  if (e.target.id === "q") {
    filtro.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos);
  }
});

// ---------- Pannello ----------
function openSheet(html) {
  $("#sheet").innerHTML = `<div class="grab"></div>` + html;
  $("#sheet").classList.remove("hidden");
  $("#sheet-bg").classList.remove("hidden");
  $("#sheet").scrollTop = 0;
}
function closeSheet() {
  $("#sheet").classList.add("hidden");
  $("#sheet-bg").classList.add("hidden");
  $("#sheet").innerHTML = "";
}
$("#sheet-bg").addEventListener("click", closeSheet);

const contiOptions = (sel) => [...new Set([...(impostazioni.conti || []), ...(sel ? [sel] : [])])]
  .map((c) => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="" ${!sel ? "selected" : ""}>—</option>`;
const catGrid = (sel) => `<div class="cat-grid">${catsOrdinate().map((c) =>
  `<button type="button" class="cat-btn ${c.id === sel ? "active" : ""}" data-pick="${esc(c.id)}"><span>${esc(c.icona)}</span>${esc(c.nome)}</button>`).join("")}</div>`;
function bindCatGrid(onPick) {
  $("#sheet").querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    $("#sheet").querySelectorAll("[data-pick]").forEach((x) => x.classList.toggle("active", x === b));
    onPick(b.dataset.pick);
  }));
}

// ---------- Spesa: nuova / modifica ----------
// opts.ricorrente: spesa confermata da una ricorrente "da confermare"
function apriSpesa(s = null, opts = {}) {
  const r = opts.ricorrente;
  const v = s || {
    data: r ? (r.prossima <= today() ? today() : r.prossima) : today(),
    importo: r && haImporto(r) ? r.importo : "", categoria: r ? r.categoria : (filtro.cat || ""), descrizione: r ? r.nome : "",
    conto: r ? r.conto : (localStorage.getItem("ultimoConto") ?? impostazioni.conti?.[0] ?? ""), note: "", consumo: "",
  };
  let cat = v.categoria;
  const ricCollegata = r || (s && s.ricorrenteId ? ricorrenti.find((x) => x.id === s.ricorrenteId) : null);
  openSheet(`
    <h2>${s ? "Modifica spesa" : r ? (haImporto(r) ? "Conferma pagamento" : "Registra " + esc(r.nome)) : "Nuova spesa"}</h2>
    ${r ? `<p class="small muted" style="margin-top:-8px">${esc(r.nome)} · previsto il ${fmtDate(r.prossima)}. ${haImporto(r) ? "Correggi l'importo se diverso." : "Inserisci l'importo della fattura."}</p>` : ""}
    <input id="f-imp" class="amount-input" inputmode="decimal" placeholder="0,00 €" value="${v.importo !== "" ? String(v.importo).replace(".", ",") : ""}">
    <div class="field"><label>Categoria</label>${catGrid(cat)}</div>
    <div class="two">
      <div class="field"><label>Data</label><input id="f-data" type="date" value="${esc(v.data)}"></div>
      <div class="field"><label>Conto</label><select id="f-conto">${contiOptions(v.conto)}</select></div>
    </div>
    <div class="field"><label>Descrizione</label><input id="f-desc" placeholder="Es. bolletta luce, spesa Conad…" value="${esc(v.descrizione)}"></div>
    <div class="field" id="f-cons-wrap"><label id="f-cons-lbl">Consumo (facoltativo)</label><input id="f-cons" inputmode="decimal" value="${v.consumo ? String(v.consumo).replace(".", ",") : ""}"></div>
    <div class="field"><label>Note</label><input id="f-note" value="${esc(v.note)}"></div>
    ${ricCollegata && haImporto(ricCollegata) ? `<label class="check"><input type="checkbox" id="f-default" checked><div><b>Usa questo importo anche per i prossimi pagamenti</b><div class="small muted">Aggiorna l'importo di "${esc(ricCollegata.nome)}" (es. cambio piano o aumento di prezzo).</div></div></label>` : ""}
    <p id="f-err" class="error"></p>
    <div class="actions">
      ${s ? `<button class="btn danger" id="f-del">Elimina</button>` : `<button class="btn" id="f-cancel">Annulla</button>`}
      <button class="btn primary" id="f-save">${r ? "Registra pagamento" : "Salva"}</button>
    </div>`);
  const consUpd = () => {
    const c = catById(cat);
    $("#f-cons-wrap").classList.toggle("hidden", !c.unita);
    $("#f-cons-lbl").textContent = `Consumo in ${c.unita || ""} (facoltativo)`;
  };
  consUpd();
  bindCatGrid((id) => { cat = id; consUpd(); });
  if (!s && !(r && haImporto(r))) setTimeout(() => $("#f-imp").focus(), 50);
  $("#f-cancel")?.addEventListener("click", closeSheet);
  $("#f-del")?.addEventListener("click", async () => {
    if (!confirm("Eliminare questa spesa?")) return;
    await deleteDoc(doc(C_SPESE, s.id));
    closeSheet(); toast("Spesa eliminata");
  });
  $("#f-save").addEventListener("click", async () => {
    const importo = num($("#f-imp").value);
    if (!(importo > 0)) { $("#f-err").textContent = "Inserisci un importo valido"; return; }
    if (!cat) { $("#f-err").textContent = "Scegli una categoria"; return; }
    const data = $("#f-data").value || today();
    const cons = num($("#f-cons").value);
    const rec = {
      data, importo: Math.round(importo * 100) / 100, categoria: cat, descrizione: $("#f-desc").value.trim(),
      conto: $("#f-conto").value, note: $("#f-note").value.trim(), consumo: catById(cat).unita && cons > 0 ? cons : null,
    };
    localStorage.setItem("ultimoConto", rec.conto);
    const nuovoDefault = $("#f-default")?.checked && ricCollegata && Number(ricCollegata.importo) !== rec.importo;
    closeSheet();
    if (nuovoDefault && !r) {
      await updateDoc(doc(C_RIC, ricCollegata.id), { importo: rec.importo });
      toast(`Nuovo importo per "${ricCollegata.nome}": ${eur(rec.importo)}`);
    }
    if (s) {
      await updateDoc(doc(C_SPESE, s.id), { ...rec, modificataDa: user.email, modificataIl: serverTimestamp() });
      if (!nuovoDefault) toast("Spesa aggiornata");
    } else if (r) {
      const b = writeBatch(db);
      b.set(doc(C_SPESE, `ric_${r.id}_${r.prossima}`), { ...nuovaSpesaDaRicorrente(r, data, rec.importo), ...rec, ricorrenteId: r.id });
      b.update(doc(C_RIC, r.id), { prossima: addMonths(r.prossima, r.frequenza || 1, r.giorno), ultimoImporto: rec.importo, ...(nuovoDefault ? { importo: rec.importo } : {}) });
      await b.commit();
      toast("Pagamento registrato");
    } else {
      await addDoc(C_SPESE, { ...rec, creataDa: user.email, creataIl: serverTimestamp() });
      toast("Spesa salvata");
    }
  });
}

function pagaRicorrente(id) {
  const r = ricorrenti.find((x) => x.id === id);
  if (r) apriSpesa(null, { ricorrente: r });
}
async function saltaRicorrente(id) {
  const r = ricorrenti.find((x) => x.id === id);
  if (!r || !confirm(`Saltare la scadenza del ${fmtDate(r.prossima)} di "${r.nome}"?\nNon verrà registrata nessuna spesa.`)) return;
  await updateDoc(doc(C_RIC, r.id), { prossima: addMonths(r.prossima, r.frequenza || 1, r.giorno) });
  toast("Scadenza saltata");
}

// ---------- Ricorrente: nuova / modifica ----------
function apriRicorrente(r = null) {
  const v = r || { nome: "", categoria: "", importo: "", frequenza: 1, prossima: today(), automatica: false, conto: impostazioni.conti?.[0] || "", attiva: true, note: "" };
  let cat = v.categoria;
  openSheet(`
    <h2>${r ? "Modifica ricorrente" : "Nuova spesa ricorrente"}</h2>
    <div class="field"><label>Nome</label><input id="r-nome" placeholder="Es. Bolletta luce, Netflix…" value="${esc(v.nome)}"></div>
    <div class="two">
      <div class="field"><label>Importo (vuoto = da fattura)</label><input id="r-imp" inputmode="decimal" placeholder="da fattura" value="${haImporto(v) ? String(v.importo).replace(".", ",") : ""}"></div>
      <div class="field"><label>Frequenza</label><select id="r-freq">${Object.entries(FREQ).map(([k, n]) => `<option value="${k}" ${Number(k) === Number(v.frequenza) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </div>
    <div class="two">
      <div class="field"><label>Prossima scadenza / arrivo</label><input id="r-prox" type="date" value="${esc(v.prossima || today())}"></div>
      <div class="field"><label>Conto</label><select id="r-conto">${contiOptions(v.conto)}</select></div>
    </div>
    <div class="field"><label>Categoria</label>${catGrid(cat)}</div>
    <label class="check"><input type="checkbox" id="r-auto" ${v.automatica ? "checked" : ""}><div><b>Addebito automatico</b><div class="small muted">Si registra da sola alla scadenza. Se disattivo, compare in "In scadenza" come promemoria e la registri tu quando arriva la fattura.</div></div></label>
    <label class="check"><input type="checkbox" id="r-attiva" ${v.attiva ? "checked" : ""}><div><b>Attiva</b><div class="small muted">Disattivala per metterla in pausa senza eliminarla.</div></div></label>
    <div class="field"><label>Note</label><input id="r-note" value="${esc(v.note || "")}"></div>
    <p id="r-err" class="error"></p>
    <div class="actions">
      ${r ? `<button class="btn danger" id="r-del">Elimina</button>` : `<button class="btn" id="r-cancel">Annulla</button>`}
      <button class="btn primary" id="r-save">Salva</button>
    </div>`);
  bindCatGrid((id) => { cat = id; if (!$("#r-nome").value) $("#r-nome").value = catById(id).nome; });
  $("#r-cancel")?.addEventListener("click", closeSheet);
  $("#r-del")?.addEventListener("click", async () => {
    if (!confirm(`Eliminare "${r.nome}"? Le spese già registrate restano.`)) return;
    await deleteDoc(doc(C_RIC, r.id));
    closeSheet(); toast("Ricorrente eliminata");
  });
  $("#r-save").addEventListener("click", async () => {
    const nome = $("#r-nome").value.trim();
    const impTxt = $("#r-imp").value.trim();
    const importo = impTxt ? num(impTxt) : null;
    const prossima = $("#r-prox").value;
    if (!nome) { $("#r-err").textContent = "Inserisci un nome"; return; }
    if (importo !== null && !(importo >= 0)) { $("#r-err").textContent = "Importo non valido"; return; }
    if (importo === null && $("#r-auto").checked) { $("#r-err").textContent = "Per l'addebito automatico serve un importo"; return; }
    if (!cat) { $("#r-err").textContent = "Scegli una categoria"; return; }
    if (!prossima) { $("#r-err").textContent = "Indica la prossima scadenza"; return; }
    const rec = {
      nome, importo: importo === null ? null : Math.round(importo * 100) / 100, frequenza: Number($("#r-freq").value), prossima, giorno: parseIso(prossima).getDate(),
      categoria: cat, automatica: $("#r-auto").checked, attiva: $("#r-attiva").checked, conto: $("#r-conto").value, note: $("#r-note").value.trim(),
    };
    closeSheet();
    if (r) await updateDoc(doc(C_RIC, r.id), rec);
    else await addDoc(C_RIC, { ...rec, creataDa: user.email, creataIl: serverTimestamp() });
    toast("Ricorrente salvata");
    if (rec.automatica && rec.attiva && rec.prossima <= today()) setTimeout(elaboraAutomatiche, 800);
  });
}

// ---------- Impostazioni ----------
function apriImpostazioni() {
  const light = localStorage.getItem("tema") === "chiaro";
  openSheet(`
    <h2>Impostazioni</h2>
    <div class="card" style="margin-top:0">
      <div class="row"><div class="avatar" style="background-image:${user.photoURL ? `url('${esc(user.photoURL)}')` : "none"}"></div>
        <div class="grow"><b>${esc(user.displayName || "")}</b><div class="small muted">${esc(user.email)}</div></div></div>
    </div>
    <label class="check"><input type="checkbox" id="s-tema" ${light ? "checked" : ""}><div><b>Tema chiaro</b></div></label>
    <div class="card"><h3>Gestione</h3>
      <div class="set-row" data-s="ric"><span class="grow">🔁 Spese ricorrenti</span><span class="muted">${ricorrenti.filter((r) => r.attiva).length} ›</span></div>
      <div class="set-row" data-s="cat"><span class="grow">🏷️ Categorie</span><span class="muted">${categorie.length} ›</span></div>
      <div class="set-row" data-s="conti"><span class="grow">💳 Conti di pagamento</span><span class="muted">${(impostazioni.conti || []).length} ›</span></div>
      ${isOwner() ? `<div class="set-row" data-s="membri"><span class="grow">👥 Persone con accesso</span><span class="muted">${membri.length + 1} ›</span></div>` : ""}
      <div class="set-row" data-s="export"><span class="grow">📥 Esporta in Excel</span><span class="muted">›</span></div>
    </div>
    <button class="btn block" id="s-out">Esci</button>
    <p class="small muted" style="text-align:center;margin-top:14px">Spese Casa · ${spese.length} spese registrate</p>`);
  $("#s-tema").addEventListener("change", (e) => { localStorage.setItem("tema", e.target.checked ? "chiaro" : "scuro"); applyTheme(); });
  $("#s-out").addEventListener("click", () => { closeSheet(); signOut(auth); });
  $("#sheet").querySelectorAll("[data-s]").forEach((el) => el.addEventListener("click", () => {
    ({ ric: () => { closeSheet(); tab = "ricorrenti"; render(); window.scrollTo(0, 0); }, cat: apriCategorie, conti: apriConti, membri: apriMembri, export: esportaExcel })[el.dataset.s]();
  }));
}

function apriCategorie() {
  const uso = new Map();
  spese.forEach((s) => uso.set(s.categoria, (uso.get(s.categoria) || 0) + 1));
  openSheet(`
    <h2>Categorie</h2>
    <p class="small muted" style="margin-top:-8px">Modifica icona, nome e colore. L'unità di consumo (es. kWh) è facoltativa.</p>
    ${catsOrdinate().map((c) => `<div class="set-row" data-id="${esc(c.id)}">
      <input class="emoji-in" value="${esc(c.icona)}" data-k="icona">
      <input class="grow" value="${esc(c.nome)}" data-k="nome" style="min-width:0">
      <input class="emoji-in" value="${esc(c.unita || "")}" data-k="unita" placeholder="unità">
      <input type="color" class="color-in" value="${esc(c.colore)}" data-k="colore">
      <button class="btn sm danger" data-delcat="${esc(c.id)}" title="${uso.get(c.id) || 0} spese">✕</button></div>`).join("")}
    <div class="set-row"><input class="emoji-in" id="nc-ico" value="🏷️"><input class="grow" id="nc-nome" placeholder="Nuova categoria"><button class="btn sm primary" id="nc-add">Aggiungi</button></div>
    <div class="actions"><button class="btn" id="c-back">Indietro</button><button class="btn primary" id="c-save">Salva modifiche</button></div>`);
  $("#c-back").addEventListener("click", apriImpostazioni);
  $("#nc-add").addEventListener("click", async () => {
    const nome = $("#nc-nome").value.trim();
    if (!nome) return;
    const id = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cat-" + Date.now();
    await setDoc(doc(C_CAT, id), { nome, icona: $("#nc-ico").value.trim() || "🏷️", colore: "#9ba5a0", ordine: 50 });
    toast("Categoria aggiunta");
    setTimeout(apriCategorie, 300);
  });
  $("#sheet").querySelectorAll("[data-delcat]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.delcat, n = uso.get(id) || 0;
    if (n) { alert(`Questa categoria ha ${n} spese: spostale prima in un'altra categoria.`); return; }
    if (!confirm("Eliminare la categoria?")) return;
    await deleteDoc(doc(C_CAT, id));
    setTimeout(apriCategorie, 300);
  }));
  $("#c-save").addEventListener("click", async () => {
    const b = writeBatch(db);
    $("#sheet").querySelectorAll(".set-row[data-id]").forEach((row) => {
      const upd = {};
      row.querySelectorAll("[data-k]").forEach((i) => { upd[i.dataset.k] = i.value.trim(); });
      if (!upd.nome) return;
      b.update(doc(C_CAT, row.dataset.id), upd);
    });
    await b.commit();
    toast("Categorie salvate");
    apriImpostazioni();
  });
}

function apriConti() {
  openSheet(`
    <h2>Conti di pagamento</h2>
    <p class="small muted" style="margin-top:-8px">Da dove escono i soldi (es. Revolut, BCC, contanti). Uno per riga.</p>
    <textarea id="k-conti" rows="5">${esc((impostazioni.conti || []).join("\n"))}</textarea>
    <div class="actions"><button class="btn" id="k-back">Indietro</button><button class="btn primary" id="k-save">Salva</button></div>`);
  $("#k-back").addEventListener("click", apriImpostazioni);
  $("#k-save").addEventListener("click", async () => {
    const conti = $("#k-conti").value.split("\n").map((s) => s.trim()).filter(Boolean);
    await setDoc(D_IMP, { conti }, { merge: true });
    impostazioni.conti = conti;
    toast("Conti salvati");
    apriImpostazioni();
  });
}

function apriMembri() {
  openSheet(`
    <h2>Persone con accesso</h2>
    <p class="small muted" style="margin-top:-8px">Solo questi account Google possono vedere e modificare le spese.</p>
    <div class="set-row"><span class="grow">${esc(OWNER)}</span><span class="badge">proprietario</span></div>
    ${membri.map((m) => `<div class="set-row"><span class="grow">${esc(m)}</span><button class="btn sm danger" data-rm="${esc(m)}">Rimuovi</button></div>`).join("")}
    <div class="set-row"><input class="grow" id="m-new" type="email" placeholder="email@gmail.com"><button class="btn sm primary" id="m-add">Aggiungi</button></div>
    <div class="actions"><button class="btn" id="m-back">Indietro</button></div>`);
  const salva = async (list) => { await setDoc(D_MEMBRI, { emails: list }); membri = list; apriMembri(); };
  $("#m-back").addEventListener("click", apriImpostazioni);
  $("#m-add").addEventListener("click", async () => {
    const e = $("#m-new").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast("Email non valida"); return; }
    if (e === OWNER || membri.includes(e)) return;
    await salva([...membri, e]);
    toast("Accesso aggiunto");
  });
  $("#sheet").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Togliere l'accesso a ${b.dataset.rm}?`)) return;
    await salva(membri.filter((m) => m !== b.dataset.rm));
  }));
}

async function esportaExcel() {
  toast("Preparo il file…");
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const rows = [...spese].sort((a, b) => a.data.localeCompare(b.data)).map((s) => ({
    Data: parseIso(s.data), Categoria: catById(s.categoria).nome, Descrizione: s.descrizione || "", Importo: Number(s.importo) || 0,
    Conto: s.conto || "", Consumo: s.consumo ?? "", Unità: s.consumo ? catById(s.categoria).unita || "" : "", Note: s.note || "",
    Ricorrente: s.ricorrenteId ? "sì" : "",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
  ws["!cols"] = [{ wch: 11 }, { wch: 20 }, { wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 6 }, { wch: 24 }, { wch: 10 }];
  for (let i = 2; i <= rows.length + 1; i++) { if (ws["A" + i]) ws["A" + i].z = "dd/mm/yyyy"; if (ws["D" + i]) ws["D" + i].z = "#,##0.00 €"; }
  XLSX.utils.book_append_sheet(wb, ws, "Spese");
  if (risparmi.length) {
    const rr = [...risparmi].sort((a, b) => a.data.localeCompare(b.data)).map((r) => ({ Data: parseIso(r.data), Importo: Number(r.importo) || 0, Nota: r.nota || "", "Registrato da": nomeDa(r.creataDa) }));
    const wr = XLSX.utils.json_to_sheet(rr, { cellDates: true });
    wr["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 34 }, { wch: 14 }];
    for (let i = 2; i <= rr.length + 1; i++) { if (wr["A" + i]) wr["A" + i].z = "dd/mm/yyyy"; if (wr["B" + i]) wr["B" + i].z = "#,##0.00 €"; }
    XLSX.utils.book_append_sheet(wb, wr, "Risparmi");
  }
  // Riepilogo anno x categoria x mese
  const anni = [...new Set(spese.map((s) => s.data.slice(0, 4)))].sort();
  for (const a of anni) {
    const data = [["Categoria", ...MESI_B.map((m) => m.toUpperCase()), "TOTALE"]];
    for (const c of catsOrdinate()) {
      const vals = MESI_B.map((_, i) => totale(spese.filter((s) => s.categoria === c.id && ym(s.data) === `${a}-${pad(i + 1)}`)));
      if (vals.some(Boolean)) data.push([c.nome, ...vals, vals.reduce((x, y) => x + y, 0)]);
    }
    const tot = MESI_B.map((_, i) => totale(spese.filter((s) => ym(s.data) === `${a}-${pad(i + 1)}`)));
    data.push(["TOTALE", ...tot, tot.reduce((x, y) => x + y, 0)]);
    const w = XLSX.utils.aoa_to_sheet(data);
    w["!cols"] = [{ wch: 22 }, ...Array(13).fill({ wch: 10 })];
    XLSX.utils.book_append_sheet(wb, w, "Riepilogo " + a);
  }
  XLSX.writeFile(wb, `Spese_Casa_${today()}.xlsx`);
}

// ---------- Importazione iniziale (usata una volta per caricare i dati dal vecchio Excel) ----------
window.__speseCasa = {
  async importa({ spese: sp = [], ricorrenti: rc = [] }) {
    if (!isOwner()) throw new Error("Solo il proprietario può importare");
    let b = writeBatch(db), n = 0;
    const flush = async () => { if (n) { await b.commit(); b = writeBatch(db); n = 0; } };
    for (const s of sp) { const { id, ...rest } = s; b.set(doc(C_SPESE, id), { ...rest, importata: true, creataDa: user.email, creataIl: serverTimestamp() }); if (++n >= 400) await flush(); }
    for (const r of rc) { const { id, ...rest } = r; b.set(doc(C_RIC, id), { ...rest, giorno: rest.giorno || parseIso(rest.prossima).getDate(), creataDa: user.email, creataIl: serverTimestamp() }); if (++n >= 400) await flush(); }
    await flush();
    return { spese: sp.length, ricorrenti: rc.length };
  },
};
