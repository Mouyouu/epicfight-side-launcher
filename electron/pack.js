'use strict';

/**
 * Verification et mise a jour du pack.
 *
 * Le launcher telecharge le manifeste (une centaine de Ko), calcule le sha1 de chaque
 * fichier deja present et compare. Il ne telecharge que ce qui manque ou differe, et
 * supprime ce qui n'est plus au manifeste. Changer un mod ne coute que ce mod.
 *
 * Consequence voulue : un fichier bricole chez le joueur est detecte et remis en etat.
 * Les "graines" (options.txt, servers.dat) echappent a cette regle - elles sont posees
 * une fois puis laissees au joueur, sinon on ecraserait sa resolution a chaque mise a jour.
 */
const fs = require('fs');
const path = require('path');
const { json, fichier, sha1Local, enParallele } = require('./reseau');
const { MANIFESTE_URL } = require('./config');

/** Dossiers que le launcher a le droit de nettoyer : jamais saves/, logs/, etc. */
const NETTOYABLES = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks',
                     'kubejs', 'datapacks', 'scripts', 'openloader', 'emotes',
                     'visual_keybinder', 'keybinding presets', 'local', 'fancymenu_data',
                     'data', 'moonlight-global-datapacks'];

async function lireManifeste() {
  const m = await json(MANIFESTE_URL + '?t=' + Date.now());   // ?t= : on court-circuite les caches
  if (!m || !Array.isArray(m.fichiers)) throw new Error('Manifeste illisible');
  return m;
}

/**
 * Compare l'installation locale au manifeste.
 * @returns {{aFaire:Array, aSupprimer:Array, octets:number, total:number}}
 */
function comparer(manifeste, racine, progression) {
  const aFaire = [];
  const attendus = new Set();
  let octets = 0;

  manifeste.fichiers.forEach((f, i) => {
    attendus.add(path.normalize(f.chemin).toLowerCase());
    const local = path.join(racine, f.chemin);
    const existe = fs.existsSync(local);

    // une graine deja posee n'est plus jamais touchee
    if (f.graine && existe) return;

    if (!existe || fs.statSync(local).size !== f.taille || sha1Local(local) !== f.sha1) {
      aFaire.push(f);
      octets += f.taille;
    }
    if (progression && i % 25 === 0) {
      progression({ etape: 'verification', fait: i, total: manifeste.fichiers.length });
    }
  });

  // fichiers en trop : un mod retire du pack doit disparaitre de chez le joueur,
  // sinon il fait planter le jeu au prochain lancement.
  const aSupprimer = [];
  for (const d of NETTOYABLES) {
    const abs = path.join(racine, d);
    if (!fs.existsSync(abs)) continue;
    (function scan(rel) {
      for (const e of fs.readdirSync(path.join(racine, rel), { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;      // caches des mods, on n'y touche pas
        const r = path.join(rel, e.name);
        if (e.isDirectory()) scan(r);
        else if (!attendus.has(r.toLowerCase())) aSupprimer.push(r);
      }
    })(d);
  }

  return { aFaire, aSupprimer, octets, total: manifeste.fichiers.length };
}

/** Telecharge les fichiers manquants et retire les surnumeraires. */
async function appliquer(manifeste, racine, plan, progression) {
  for (const rel of plan.aSupprimer) {
    try { fs.unlinkSync(path.join(racine, rel)); } catch { /* deja parti */ }
  }

  let recus = 0;
  let faits = 0;
  const taches = plan.aFaire.map((f) => async () => {
    await fichier(manifeste.base + f.asset, path.join(racine, f.chemin), {
      sha1: f.sha1,
      onOctets: (n) => {
        recus += n;
        if (progression) {
          progression({ etape: 'telechargement', octets: recus, octetsTotal: plan.octets,
                        fait: faits, total: plan.aFaire.length, fichier: f.chemin });
        }
      },
    });
    faits++;
  });

  await enParallele(taches, 8);
  return { telecharges: plan.aFaire.length, supprimes: plan.aSupprimer.length };
}

/** Verifie, met a jour si besoin, et rend un compte rendu. */
async function synchroniser(racine, progression) {
  const manifeste = await lireManifeste();
  const plan = comparer(manifeste, racine, progression);
  if (!plan.aFaire.length && !plan.aSupprimer.length) {
    return { version: manifeste.version, aJour: true, telecharges: 0, supprimes: 0 };
  }
  const r = await appliquer(manifeste, racine, plan, progression);
  return { version: manifeste.version, aJour: false, ...r };
}

/** Repose les graines (options.txt, servers.dat) sur demande explicite du joueur. */
async function reappliquerReglages(racine, progression) {
  const manifeste = await lireManifeste();
  const graines = manifeste.fichiers.filter((f) => f.graine);
  await enParallele(graines.map((f) => async () => {
    await fichier(manifeste.base + f.asset, path.join(racine, f.chemin), { sha1: f.sha1 });
    if (progression) progression({ etape: 'reglages', fichier: f.chemin });
  }), 4);
  return graines.length;
}

module.exports = { lireManifeste, comparer, synchroniser, reappliquerReglages };
