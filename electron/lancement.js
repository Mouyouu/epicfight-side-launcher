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
const { cheminLib, autorisee, extraireNatives } = require('./installateur');
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

const remplacer = (a, valeurs) =>
  a.replace(/\$\{(\w+)\}/g, (t, c) => (c in valeurs ? valeurs[c] : t));

/**
 * Une regle du client.json de Mojang n'est retenue que si TOUTES ses conditions le sont.
 *
 * Le "features" est le point qui manquait. Mojang conditionne certains arguments a des
 * fonctionnalites optionnelles du launcher :
 *
 *   {"rules":[{"action":"allow","features":{"has_custom_resolution":true}}],
 *    "value":["--width","${resolution_width}","--height","${resolution_height}"]}
 *
 * Cette regle n'a pas de "os", donc l'ancien test la laissait passer. Le jeu recevait
 * "--width ${resolution_width}" et refusait de demarrer :
 *   Cannot parse argument '${resolution_width}' of option width
 * Nous n'activons aucune de ces fonctionnalites : toute regle qui en exige une est ecartee.
 */
function regleRetenue(r) {
  if (r.action !== 'allow') return false;
  if (r.os && r.os.name !== (estWindows ? 'windows' : 'linux')) return false;
  if (r.features && Object.values(r.features).some(Boolean)) return false;
  return true;
}

/** Remplace les ${...} des arguments par leurs valeurs. */
function substituer(args, valeurs) {
  const sortie = [];
  for (const a of args) {
    if (typeof a === 'string') {
      sortie.push(remplacer(a, valeurs));
    } else if (a && Array.isArray(a.value)
               && (!a.rules || a.rules.every(regleRetenue))) {
      // La substitution s'applique AUSSI ici. L'ancienne version poussait les valeurs
      // brutes, donc un argument conditionnel gardait ses ${...} meme quand il etait
      // legitimement retenu.
      for (const v of a.value) sortie.push(remplacer(String(v), valeurs));
    }
  }
  return sortie;
}

/**
 * Dernier filet : on ne transmet jamais au jeu un ${...} non resolu.
 *
 * Si une version future de Mojang introduit une variable qu'on ne connait pas, le jeu
 * refuserait de demarrer avec un message illisible pour le joueur. On retire donc la
 * valeur restee symbolique, et l'option qui la precede - sinon "--width" se retrouverait
 * sans valeur, ce qui echoue tout autant.
 */
function retirerNonResolus(args) {
  const sortie = [];
  for (const a of args) {
    if (typeof a === 'string' && a.includes('${')) {
      if (sortie.length && /^--/.test(sortie[sortie.length - 1])) sortie.pop();
      continue;
    }
    sortie.push(a);
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

  /* Les natives sont verifiees ICI, a chaque lancement, et pas seulement a
     l'installation.

     Deux raisons. D'abord elles n'etaient extraites nulle part : les installations
     deja faites ont un dossier natives vide, et on ne va pas demander de tout
     reinstaller pour 21 dll. Ensuite le test est instantane quand tout va bien - on
     compte les fichiers - alors qu'une absence coute un demarrage rate avec un
     message que personne ne sait lire :
       java.lang.UnsatisfiedLinkError: Failed to locate library: lwjgl.dll */
  const dejaLa = fs.readdirSync(natives).filter((f) => /\.(dll|so|dylib)$/i.test(f)).length;
  if (dejaLa === 0) {
    const n = extraireNatives(racine, chaine);
    if (!n) throw new Error("Bibliotheques natives introuvables : le jeu ne peut pas demarrer");
  }

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
  jeu = retirerNonResolus(jeu);
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
