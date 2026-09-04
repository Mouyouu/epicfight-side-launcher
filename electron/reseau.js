'use strict';

/** Telechargements et JSON, sans dependance externe. Suit les redirections. */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_REDIR = 6;

function ouvrir(url, entetes, restant) {
  return new Promise((resoudre, rejeter) => {
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': 'EpicfightSideLauncher', ...entetes } }, (rep) => {
      const code = rep.statusCode;
      if (code >= 300 && code < 400 && rep.headers.location) {
        rep.resume();
        if (restant <= 0) return rejeter(new Error('Trop de redirections'));
        return resoudre(ouvrir(new URL(rep.headers.location, url).href, entetes, restant - 1));
      }
      if (code < 200 || code >= 300) {
        rep.resume();
        return rejeter(new Error(`HTTP ${code} sur ${url}`));
      }
      resoudre(rep);
    });
    req.on('error', rejeter);
    req.setTimeout(30000, () => req.destroy(new Error('Délai dépassé : ' + url)));
  });
}

async function texte(url, entetes = {}) {
  const rep = await ouvrir(url, entetes, MAX_REDIR);
  let brut = '';
  for await (const bout of rep) brut += bout;
  return brut;
}

const json = async (url, entetes) => JSON.parse(await texte(url, entetes));

/**
 * Telecharge vers un fichier. Verifie le sha1 si fourni, et n'ecrit le fichier
 * definitif qu'apres controle : une coupure reseau ne laisse pas de fichier corrompu.
 */
async function fichier(url, destination, { sha1: attendu = null, onOctets = null } = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmp = destination + '.part';
  const rep = await ouvrir(url, {}, MAX_REDIR);
  const h = crypto.createHash('sha1');
  const sortie = fs.createWriteStream(tmp);

  await new Promise((resoudre, rejeter) => {
    rep.on('data', (bout) => { h.update(bout); if (onOctets) onOctets(bout.length); });
    rep.on('error', rejeter);
    sortie.on('error', rejeter);
    sortie.on('finish', resoudre);
    rep.pipe(sortie);
  });

  const obtenu = h.digest('hex');
  if (attendu && obtenu !== attendu) {
    fs.unlinkSync(tmp);
    throw new Error(`Empreinte incorrecte pour ${path.basename(destination)}`);
  }
  fs.renameSync(tmp, destination);
  return obtenu;
}

/** Empreinte d'un fichier existant, null s'il n'existe pas. */
function sha1Local(chemin) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex');
  } catch {
    return null;
  }
}

/** Execute des taches par lots, pour ne pas ouvrir 200 connexions d'un coup. */
async function enParallele(taches, largeur = 8) {
  const files = [];
  let i = 0;
  for (let n = 0; n < Math.min(largeur, taches.length); n++) {
    files.push((async () => {
      while (i < taches.length) {
        const k = i++;
        await taches[k]();
      }
    })());
  }
  await Promise.all(files);
}

module.exports = { texte, json, fichier, sha1Local, enParallele };
