'use strict';

/**
 * Construit la ligne de commande du jeu et le lance.
 *
 * Le classpath et les arguments sont deduits des deux client.json (vanilla puis Forge),
 * jamais ecrits en dur : une revision de Forge qui ajoute une bibliotheque est prise en
 * compte sans toucher a ce fichier.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { cheminLib, autorisee } = require('./installateur');
const { MINECRAFT, RAM, SERVEUR } = require('./config');

const estWindows = process.platform === 'win32';
const SEPARATEUR = estWindows ? ';' : ':';

const lireProfil = (racine, id) =>
  JSON.parse(fs.readFileSync(path.join(racine, 'versions', id, `${id}.json`), 'utf8'));

/** Remonte la chaine d'heritage : le profil Forge herite du profil vanilla. */
function chaineProfils(racine, id) {
  const chaine = [];
  let courant = id;
  while (courant) {
    const p = lireProfil(racine, courant);
    chaine.push(p);
    courant = p.inheritsFrom;
  }
  return chaine;   // du plus specifique au plus general
}

function construireClasspath(racine, chaine) {
  const vus = new Set();
  const cp = [];
  for (const profil of chaine) {
    for (const lib of (profil.libraries || [])) {
      if (!autorisee(lib)) continue;
      const [g, a] = lib.name.split(':');
      const cle = g + ':' + a;                  // une seule version par artefact
      if (vus.has(cle)) continue;
      vus.add(cle);
      const chemin = lib.downloads?.artifact
        ? path.join(racine, 'libraries', lib.downloads.artifact.path)
        : cheminLib(lib.name, racine);
      if (fs.existsSync(chemin)) cp.push(chemin);
    }
  }
  cp.push(path.join(racine, 'versions', MINECRAFT, `${MINECRAFT}.jar`));
  return cp.join(SEPARATEUR);
}

/** Remplace les ${...} des arguments par leurs valeurs. */
function substituer(args, valeurs) {
  const sortie = [];
  for (const a of args) {
    if (typeof a === 'string') {
      sortie.push(a.replace(/\$\{(\w+)\}/g, (t, c) => (c in valeurs ? valeurs[c] : t)));
    } else if (a && Array.isArray(a.value) && (!a.rules || a.rules.every(
      (r) => r.action === 'allow' && (!r.os || r.os.name === (estWindows ? 'windows' : 'linux'))))) {
      for (const v of a.value) sortie.push(v);
    }
  }
  return sortie;
}

/**
 * @param {object} o
 * @param {string} o.racine   dossier de jeu
 * @param {string} o.java     chemin de javaw
 * @param {string} o.idForge  identifiant du profil Forge
 * @param {object} o.compte   { pseudo, uuid, jeton }
 * @param {boolean} o.rejoindre  se connecter directement au serveur
 */
function lancer({ racine, java, idForge, compte, assetIndex, ram = RAM.max,
                  rejoindre = false, onSortie }) {
  const chaine = chaineProfils(racine, idForge);
  const principal = chaine[0].mainClass;
  const classpath = construireClasspath(racine, chaine);
  const natives = path.join(racine, 'natives');
  fs.mkdirSync(natives, { recursive: true });

  const valeurs = {
    auth_player_name: compte.pseudo,
    auth_uuid: compte.uuid,
    auth_access_token: compte.jeton,
    user_type: 'msa',
    version_name: idForge,
    game_directory: racine,
    assets_root: path.join(racine, 'assets'),
    assets_index_name: assetIndex,
    version_type: 'release',
    natives_directory: natives,
    launcher_name: 'EpicfightSide',
    launcher_version: '1.0',
    classpath,
    library_directory: path.join(racine, 'libraries'),
    classpath_separator: SEPARATEUR,
    clientid: '', auth_xuid: '', resolution_width: '', resolution_height: '',
  };

  // arguments JVM : ceux des profils, puis les notres
  let jvm = [];
  for (const p of [...chaine].reverse()) {
    if (p.arguments?.jvm) jvm = jvm.concat(substituer(p.arguments.jvm, valeurs));
  }
  if (!jvm.length) jvm = [`-Djava.library.path=${natives}`, '-cp', classpath];

  jvm.unshift(`-Xms${Math.min(RAM.min, ram)}G`, `-Xmx${ram}G`);
  // reglages recommandes par les developpeurs de Forge pour les gros packs
  jvm.push('-XX:+UseG1GC', '-XX:MaxGCPauseMillis=100', '-XX:+ParallelRefProcEnabled',
           '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20',
           '-XX:G1HeapRegionSize=32M', '-Dfml.ignoreInvalidMinecraftCertificates=true');

  let jeu = [];
  for (const p of [...chaine].reverse()) {
    if (p.arguments?.game) jeu = jeu.concat(substituer(p.arguments.game, valeurs));
    else if (p.minecraftArguments) {
      jeu = jeu.concat(substituer(p.minecraftArguments.split(' '), valeurs));
    }
  }
  if (rejoindre) jeu.push('--quickPlayMultiplayer', `${SERVEUR.hote}:${SERVEUR.port}`);

  const enfant = spawn(java, [...jvm, principal, ...jeu], {
    cwd: racine, detached: false, windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (onSortie) {
    enfant.stdout.on('data', (b) => onSortie(b.toString()));
    enfant.stderr.on('data', (b) => onSortie(b.toString()));
  }
  return enfant;
}

module.exports = { lancer, chaineProfils, construireClasspath };
