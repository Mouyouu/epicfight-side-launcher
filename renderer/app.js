'use strict';

/* Interface du launcher. Aucun acces au systeme ici : tout passe par window.launcher,
   dont la liste des fonctions est fixee dans electron/preload.js.
   La mise en page reprend la maquette validee : rail, actualites, socle, progression. */

const $ = (id) => document.getElementById(id);
const app = $('app');

const poids = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + ' Ko'
                    : n < 1073741824 ? (n / 1048576).toFixed(0) + ' Mo'
                    : (n / 1073741824).toFixed(2).replace('.', ',') + ' Go');

let etat = { compte: null, occupe: false, aJour: null };

// ------------------------------------------------------------------ decor

/* Brume et poussiere en Canvas, repris tel quel de la maquette : aucune illustration
   a embarquer, et le decor ne vieillit pas. */
(function decor() {
  const cv = $('deco'), cx = cv.getContext('2d');
  let L = 0, H = 0, pts = [], nuees = [], anim = null, tps = 0;
  const doux = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function taille() {
    const r = cv.getBoundingClientRect(), k = Math.min(devicePixelRatio || 1, 2);
    L = r.width; H = r.height;
    cv.width = L * k; cv.height = H * k;
    cx.setTransform(k, 0, 0, k, 0, 0);
  }
  function semer() {
    pts = Array.from({ length: 120 }, () => ({
      x: Math.random() * L, y: Math.random() * H,
      r: Math.random() * 1.4 + .25, vy: -(Math.random() * .16 + .03),
      vx: (Math.random() - .5) * .09, a: Math.random() * .42 + .08,
      ph: Math.random() * 6.28,
    }));
    nuees = Array.from({ length: 5 }, (_, i) => ({
      x: L * (.2 + i * .19), y: H * (.18 + Math.random() * .6),
      r: Math.max(L, H) * (.26 + Math.random() * .2),
      v: .00012 + Math.random() * .00016, ph: i * 1.7,
    }));
  }
  function fond() {
    const gr = cx.createLinearGradient(0, 0, L * .8, H);
    gr.addColorStop(0, '#0A0A0A'); gr.addColorStop(.5, '#101418'); gr.addColorStop(1, '#0A0A0A');
    cx.fillStyle = gr; cx.fillRect(0, 0, L, H);
    for (const n of nuees) {
      const x = n.x + Math.sin(tps * n.v + n.ph) * L * .07;
      const y = n.y + Math.cos(tps * n.v * .7 + n.ph) * H * .05;
      const r = cx.createRadialGradient(x, y, 0, x, y, n.r);
      r.addColorStop(0, 'rgba(48,80,136,.17)');
      r.addColorStop(.45, 'rgba(56,136,136,.075)');
      r.addColorStop(1, 'transparent');
      cx.fillStyle = r; cx.fillRect(0, 0, L, H);
    }
  }
  function boucle() {
    tps++; fond();
    for (const q of pts) {
      q.y += q.vy; q.x += q.vx + Math.sin(q.ph += .01) * .13;
      if (q.y < -6) { q.y = H + 6; q.x = Math.random() * L; }
      cx.beginPath(); cx.arc(q.x, q.y, q.r, 0, 6.283);
      cx.fillStyle = 'rgba(120,248,248,' + q.a + ')'; cx.fill();
    }
    anim = requestAnimationFrame(boucle);
  }
  function demarrer() {
    taille(); semer(); fond();
    if (anim) cancelAnimationFrame(anim);
    if (!doux) boucle();
  }
  addEventListener('resize', demarrer);
  demarrer();
})();

// ------------------------------------------------------------------ messages

let minuteurAlerte = null;
function alerter(texte, genre = 'erreur') {
  const a = $('alerte');
  a.textContent = texte;
  a.classList.toggle('info', genre === 'info');
  a.hidden = false;
  clearTimeout(minuteurAlerte);
  minuteurAlerte = setTimeout(() => { a.hidden = true; }, 9000);
}

// ------------------------------------------------------------------ tete du skin

/* Decoupe la tete dans la texture officielle du joueur (8x8 a 8,8, plus le calque
   chapeau a 40,8). On lit la peau du profil Minecraft : aucun service d'avatars tiers. */
async function dessinerTete(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((ok, ko) => {
    // Sans delai, une texture qui ne repond jamais laisse un carre vide pour toujours,
    // sans le moindre message. On prefere echouer vite et le dire.
    const minuteur = setTimeout(() => ko(new Error('texture injoignable apres 8 s')), 8000);
    img.onload = () => { clearTimeout(minuteur); ok(); };
    img.onerror = () => { clearTimeout(minuteur); ko(new Error('texture refusee : ' + url)); };
    img.src = url;
  });
  const T = 64;
  const c = document.createElement('canvas');
  c.width = c.height = T;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 8, 8, 8, 8, 0, 0, T, T);
  x.drawImage(img, 40, 8, 8, 8, 0, 0, T, T);
  return c.toDataURL();   // leve une SecurityError si la source n'autorise pas le CORS
}

/* Vignette de repli : l'initiale du pseudo sur une couleur tiree de l'uuid.
   Elle existe pour qu'il y ait TOUJOURS quelque chose a cet endroit. Un carre vide
   ne dit rien ; une initiale dit au moins qui est connecte. */
function teteDeSecours(pseudo, uuid) {
  const T = 64;
  const c = document.createElement('canvas');
  c.width = c.height = T;
  const x = c.getContext('2d');
  let h = 0;
  for (const ch of String(uuid || pseudo || '?')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  x.fillStyle = `hsl(${h} 32% 26%)`;
  x.fillRect(0, 0, T, T);
  x.fillStyle = `hsl(${h} 55% 78%)`;
  x.font = '600 34px Barlow, system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText((pseudo || '?').slice(0, 1).toUpperCase(), T / 2, T / 2 + 2);
  return c.toDataURL();
}

/* Pose la tete, et n'echoue jamais en silence.
   Trois causes possibles, toutes traitees : le profil ne renvoie aucune peau active,
   la texture ne se charge pas, ou le canvas refuse d'etre lu. Dans les trois cas on
   affiche le repli et on ecrit la raison exacte dans la console et dans l'infobulle. */
async function posterTete(compte) {
  const img = $('tete');
  img.alt = compte.pseudo || '';
  img.title = compte.pseudo || '';
  try {
    if (!compte.peau) {
      throw new Error("le profil Minecraft ne renvoie aucune peau active (skins[] vide)");
    }
    img.src = await dessinerTete(compte.peau);
  } catch (e) {
    const raison = (e && e.message) ? e.message : String(e);
    console.warn('[tete] repli sur le monogramme :', raison);
    img.src = teteDeSecours(compte.pseudo, compte.uuid);
    img.title = compte.pseudo + ' — peau indisponible : ' + raison;
  }
}

// ------------------------------------------------------------------ compte

function afficherCompte(compte) {
  etat.compte = compte;
  $('moi').hidden = !compte;
  app.dataset.vue = compte ? 'jeu' : 'connexion';
  if (compte) {
    $('pseudo').textContent = compte.pseudo;
    posterTete(compte);
  }
  majBouton();
}

function majBouton() {
  const b = $('jouer');
  if (!etat.compte)      { b.disabled = true;  b.textContent = 'Connectez-vous'; }
  else if (etat.occupe)  { b.disabled = true;  b.textContent = 'Patientez'; }
  else if (etat.aJour === false) { b.disabled = false; b.textContent = 'Mettre à jour'; }
  else                   { b.disabled = false; b.textContent = 'Jouer'; }
}

// ------------------------------------------------------------------ serveur

async function rafraichirServeur() {
  const r = await window.launcher.etatServeur();
  $('pastille').className = 'pastille ' + (r.enLigne ? 'en-ligne' : 'hors-ligne');
  $('etatServeur').textContent = r.enLigne ? 'Serveur en ligne' : 'Serveur hors ligne';
  $('joueurs').textContent = r.enLigne ? `${r.joueurs} / ${r.max}` : '—';
  $('ping').textContent = r.enLigne ? `${r.ping} ms` : '';
}

// ------------------------------------------------------------------ progression

const LIBELLES = {
  java: 'Environnement Java', minecraft: 'Minecraft', ressources: 'Ressources du jeu',
  forge: 'Forge', pack: 'Pack Epicfight Side', verification: 'Vérification des fichiers',
  telechargement: 'Téléchargement', reglages: 'Réglages', lancement: 'Lancement',
};

function progresser(d) {
  if (d.etape === 'session') return afficherCompte(d.compte);
  if (d.etape === 'journal') return;                   // sortie du jeu, non affichee

  if (d.etape === 'termine') {
    etat.occupe = false;
    $('etat').textContent = 'Le jeu s\'est fermé';
    $('octets').textContent = ''; $('pct').textContent = '';
    $('detail').textContent = '';
    $('jauge').classList.remove('indetermine');
    $('jauge').style.width = '0%';
    majBouton();
    verifierPack();
    if (d.code) alerter(`Minecraft s'est arrêté (code ${d.code}).`);
    return;
  }

  const jauge = $('jauge');
  $('etat').textContent = LIBELLES[d.etape] || d.etape;

  if (d.octetsTotal) {
    const part = d.octets / d.octetsTotal;
    jauge.classList.remove('indetermine');
    jauge.style.width = (part * 100).toFixed(1) + '%';
    $('pct').textContent = Math.round(part * 100) + ' %';
    $('octets').textContent = `${poids(d.octets)} / ${poids(d.octetsTotal)}`;
    $('detail').textContent = d.fichier || '';
  } else if (d.total) {
    const part = d.fait / d.total;
    jauge.classList.remove('indetermine');
    jauge.style.width = (part * 100).toFixed(1) + '%';
    $('pct').textContent = Math.round(part * 100) + ' %';
    $('octets').textContent = `${d.fait} / ${d.total}`;
    $('detail').textContent = d.detail || '';
  } else {
    jauge.classList.add('indetermine');
    $('pct').textContent = '';
    $('octets').textContent = '';
    $('detail').textContent = d.detail || '';
  }
}

// ------------------------------------------------------------------ actions

async function seConnecter() {
  const b = $('connexion');
  b.disabled = true;
  const r = await window.launcher.connexion();
  b.disabled = false;
  if (!r.ok) return alerter('Connexion impossible : ' + r.erreur);
  afficherCompte(r.compte);
  verifierPack();
}

async function jouer() {
  if (etat.occupe || !etat.compte) return;
  etat.occupe = true; majBouton();
  $('etat').textContent = 'Préparation';
  $('jauge').classList.add('indetermine');

  const r = await window.launcher.jouer();
  if (!r.ok) {
    etat.occupe = false;
    $('jauge').classList.remove('indetermine');
    $('etat').textContent = 'Arrêté';
    majBouton();
    return alerter(r.erreur);
  }
  $('etat').textContent = 'Minecraft est lancé';
  $('jauge').classList.remove('indetermine');
  $('jauge').style.width = '100%';
  $('pct').textContent = '100 %';
  etat.aJour = true;
}

async function verifierPack() {
  const r = await window.launcher.verifier();
  if (!r.ok) { $('versionPack').textContent = 'Pack non publié'; return; }
  etat.aJour = r.aJour;
  $('versionPack').textContent = `Pack ${r.version} · MC 1.20.1`;
  majBouton();
  if (!r.aJour && r.fichiers) {
    $('etat').textContent = 'Mise à jour disponible';
    $('octets').textContent = `${r.fichiers} fichier(s) · ${poids(r.octets)}`;
  } else if (r.aJour) {
    $('etat').textContent = 'Tout est à jour';
  }
}

// ------------------------------------------------------------------ navigation

const DOCUMENTS = {
  guide:   { titre: 'Guide des boss', fichier: 'documents/guide-boss.html' },
  touches: { titre: 'Toutes les touches', fichier: 'documents/touches.html' },
};

function onglet(nom) {
  const doc = DOCUMENTS[nom];
  $('lecteur').hidden = !doc;
  $('panneauReglages').hidden = nom !== 'reglages';
  // le panneau d'actualites cede la place au lecteur, qui prend toute la largeur
  $('actus').hidden = nom === 'reglages' || !!doc;

  if (doc) {
    $('titreDoc').textContent = doc.titre;
    const cadre = $('cadreDoc');
    // on ne recharge pas un document deja affiche : le joueur garde sa position
    if (!cadre.src.endsWith(doc.fichier)) cadre.src = doc.fichier;
  }
  for (const a of document.querySelectorAll('nav a[data-onglet]')) {
    if (a.dataset.onglet === nom) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ------------------------------------------------------------------ demarrage

(async function demarrer() {
  const c = await window.launcher.config();
  document.title = c.nom;

  // actualites : editables dans electron/config.js, pas de service distant a maintenir
  $('listeActus').innerHTML = '';
  for (const n of (c.actualites || [])) {
    const el = document.createElement('article');
    el.className = 'actu';
    const v = document.createElement('span');
    v.className = 'vig';
    v.style.background = n.couleur || 'linear-gradient(140deg,#305088,#202848)';
    const d = document.createElement('div');
    const t = document.createElement('div'); t.className = 't'; t.textContent = n.titre;
    const j = document.createElement('div'); j.className = 'd'; j.textContent = n.date;
    d.append(t, j); el.append(v, d);
    $('listeActus').append(el);
  }

  for (const el of document.querySelectorAll('[data-onglet]')) {
    el.addEventListener('click', (e) => { e.preventDefault(); onglet(el.dataset.onglet); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onglet(el.dataset.onglet); }
    });
  }
  $('fermerDoc').addEventListener('click', () => onglet('accueil'));

  $('reduire').addEventListener('click', () => window.launcher.reduire());
  $('fermer').addEventListener('click', () => window.launcher.fermer());
  $('connexion').addEventListener('click', seConnecter);
  $('jouer').addEventListener('click', jouer);
  $('deconnexion').addEventListener('click', async () => {
    await window.launcher.deconnexion();
    afficherCompte(null);
  });
  $('ouvrirDossier').addEventListener('click', () => window.launcher.ouvrirDossier());
  $('rejouerReglages').addEventListener('click', async () => {
    const r = await window.launcher.reglagesParDefaut();
    alerter(r.ok ? `Réglages reposés (${r.poses} fichier(s)). Relance le jeu.`
                 : 'Impossible : ' + r.erreur, r.ok ? 'info' : 'erreur');
  });

  // parametres
  const reglages = await window.launcher.lireReglages();
  const ram = $('ram');
  ram.value = reglages.ram || 8;
  $('ramValeur').textContent = ram.value + ' Go';
  ram.addEventListener('input', () => { $('ramValeur').textContent = ram.value + ' Go'; });
  ram.addEventListener('change', () => window.launcher.ecrireReglages({ ram: +ram.value }));
  const rej = $('rejoindre');
  rej.checked = reglages.rejoindre !== false;
  rej.addEventListener('change', () => window.launcher.ecrireReglages({ rejoindre: rej.checked }));
  $('cheminJeu').textContent = await window.launcher.dossierJeu();

  window.launcher.surProgression(progresser);

  const compte = await window.launcher.compte();
  afficherCompte(compte);

  rafraichirServeur();
  setInterval(rafraichirServeur, 30000);
  if (compte) verifierPack();
})();
