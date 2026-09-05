'use strict';

/**
 * Contenu editorial mis a jour sans reinstaller le launcher : les actualites et
 * les donnees du guide des boss.
 *
 * ON NE TELECHARGE QUE DES DONNEES, JAMAIS DU CODE
 * La solution evidente serait de telecharger guide-boss.html et de l'afficher.
 * Ce serait executer du JavaScript distant dans le launcher : quiconque obtient
 * l'acces au depot ferait tourner son code chez tous les joueurs, au premier
 * lancement, sans qu'ils aient rien installe. Pour un guide de boss, c'est cher
 * paye.
 *
 * Le gabarit du guide reste donc EMBARQUE dans l'application - c'est lui qui
 * porte le code - et seule la liste des boss vient du reseau. On assemble les
 * deux localement. Au pire, un fichier distant corrompu donne un guide vide ;
 * jamais du code qui s'execute.
 *
 * TROIS SOURCES, DANS CET ORDRE
 *   1. le fichier distant, s'il repond ;
 *   2. le dernier telechargement reussi, garde en cache ;
 *   3. la copie embarquee dans l'application, qui existe toujours.
 * Le joueur hors ligne voit donc toujours quelque chose.
 */
const fs = require('fs');
const path = require('path');
const { json } = require('./reseau');
const config = require('./config');

// Attente courte : le contenu editorial ne doit jamais retarder le lancement du
// jeu. S'il n'arrive pas, on affiche celui qu'on a deja.
const DELAI = 6000;

let dossier = null;      // cache, dans les donnees de l'application
let racineEmbarquee = null;

function ouvrir(dossierDonnees, racineApp) {
  dossier = path.join(dossierDonnees, 'contenu');
  racineEmbarquee = racineApp;
  fs.mkdirSync(dossier, { recursive: true });
}

const cheminCache = (nom) => path.join(dossier, nom);

function lireJson(chemin) {
  try {
    return JSON.parse(fs.readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Rapporte le contenu de <nom>, en essayant le reseau puis les replis.
 * @param {string} nom            ex. "actualites.json"
 * @param {(v:any)=>boolean} valide  refuse une reponse de forme inattendue
 * @param {string} embarque       chemin relatif de la copie embarquee
 */
async function recuperer(nom, valide, embarque) {
  if (config.CONTENU_BASE) {
    try {
      const distant = await Promise.race([
        json(config.CONTENU_BASE + nom),
        new Promise((_, ko) => setTimeout(() => ko(new Error('délai dépassé')), DELAI)),
      ]);
      // Un fichier distant mal forme ne doit pas effacer un cache valide.
      if (valide(distant)) {
        fs.writeFileSync(cheminCache(nom), JSON.stringify(distant), 'utf8');
        return { valeur: distant, source: 'réseau' };
      }
      console.warn('[contenu] %s ignoré : forme inattendue', nom);
    } catch (e) {
      console.warn('[contenu] %s indisponible : %s', nom, e.message);
    }
  }
  const cache = lireJson(cheminCache(nom));
  if (valide(cache)) return { valeur: cache, source: 'cache' };
  const local = lireJson(path.join(racineEmbarquee, embarque));
  if (valide(local)) return { valeur: local, source: 'embarqué' };
  return { valeur: null, source: 'aucune' };
}

// ------------------------------------------------------------------ actualites

const actusValides = (v) => Array.isArray(v) && v.every(
  (a) => a && typeof a.titre === 'string' && typeof a.date === 'string');

async function actualites() {
  const r = await recuperer('actualites.json', actusValides, 'contenu/actualites.json');
  // Trois suffisent : le panneau n'en montre pas plus sans devenir une liste.
  return { liste: (r.valeur || config.ACTUALITES).slice(0, 3), source: r.source };
}

// ------------------------------------------------------------------ guide

const guideValide = (v) => Array.isArray(v) && v.length > 0
  && v.every((b) => b && typeof b.id === 'string' && typeof b.nom === 'string');

/**
 * Assemble le guide : gabarit embarque + donnees distantes.
 *
 * Le resultat est ecrit dans les donnees de l'application, pas dans le dossier
 * d'installation - celui-ci est en lecture seule une fois le launcher installe.
 * Rend le chemin du fichier a afficher, ou null pour garder celui d'origine.
 */
async function guide() {
  const gabarit = path.join(racineEmbarquee, 'renderer', 'documents', 'guide-boss.html');
  if (!fs.existsSync(gabarit)) return null;

  const r = await recuperer('guide-boss.json', guideValide, 'contenu/guide-boss.json');
  if (!r.valeur || r.source === 'embarqué') return null;   // le gabarit suffit

  try {
    const html = fs.readFileSync(gabarit, 'utf8');
    const marque = '<script id="donnees" type="application/json">';
    const debut = html.indexOf(marque);
    const fin = html.indexOf('</script>', debut);
    if (debut < 0 || fin < 0) return null;

    // On echappe "<" : une donnee contenant "</script>" fermerait le bloc et le
    // reste serait interprete comme du HTML. C'est la seule injection possible
    // ici, et elle est fermee.
    const donnees = JSON.stringify(r.valeur).replace(/</g, '\\u003c');
    const sortie = path.join(dossier, 'guide-boss.html');
    fs.writeFileSync(sortie,
      html.slice(0, debut + marque.length) + donnees + html.slice(fin), 'utf8');

    // Les icones sont referencees en relatif (img/…) : sans elles, les vignettes
    // seraient cassees dans le fichier assemble.
    lierImages(path.dirname(gabarit));
    return sortie;
  } catch (e) {
    console.warn('[contenu] assemblage du guide impossible : %s', e.message);
    return null;
  }
}

function lierImages(sourceImg) {
  const src = path.join(sourceImg, 'img');
  const dst = path.join(dossier, 'img');
  if (!fs.existsSync(src) || fs.existsSync(dst)) return;
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  } catch { /* les vignettes ne valent pas un echec */ }
}

module.exports = { ouvrir, actualites, guide };
