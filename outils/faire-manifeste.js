'use strict';

/**
 * Prepare la distribution du pack a partir de ton instance de jeu.
 *
 *   node outils/faire-manifeste.js "C:\\Users\\Mouyou\\curseforge\\minecraft\\Instances\\EPICFIGHT MOD" 1.4.2
 *
 * Produit dans distribution/ :
 *   manifeste.json   la liste de TOUS les fichiers du pack, avec taille et sha1
 *   fichiers/        les memes fichiers, renommes a plat pour GitHub Releases
 *   pack-complet.zip une archive de secours, pour une installation manuelle
 *
 * COMMENT LE JOUEUR SAIT QU'IL EST A JOUR
 * --------------------------------------
 * Le launcher telecharge manifeste.json (quelques dizaines de Ko), calcule le sha1 de
 * chaque fichier qu'il a deja, et compare. Il ne telecharge que les fichiers absents ou
 * dont l'empreinte differe, et supprime ceux qui ne sont plus au manifeste. Changer un
 * seul mod ne coute donc que le poids de ce mod, pas les 741 Mo du pack.
 *
 * Le champ "version" ne sert qu'a l'affichage : c'est la comparaison des empreintes qui
 * fait foi. Un fichier modifie a la main chez le joueur est detecte et remis en etat.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Ce qu'on distribue : uniquement nos fichiers. Minecraft, Forge et Java sont
// telecharges par le launcher depuis les serveurs officiels.
//
// Releve sur l'instance reelle : le design ne tient pas que dans config/. FancyMenu y met
// bien ses 15 Mo (config/fancymenu) et Drippy sa configuration, mais les emotes, les
// presets de touches et les reglages FTB vivent a la racine.
const DOSSIERS = [
  'mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks',
  'kubejs', 'datapacks', 'scripts', 'openloader', 'moonlight-global-datapacks',
  'emotes',              // emotes personnalisees d'Emotecraft
  'visual_keybinder',    // dispositions de l'editeur visuel de touches
  'keybinding presets',  // preset applique au premier demarrage
  'local',               // reglages client FTB Library
  'fancymenu_data',      // compagnon anime et donnees de FancyMenu
  'data',                // fabricDefaultResourcePacks.dat : les packs actives par defaut

  // Armourer's Workshop : on descend d'un cran a dessein.
  // Le dossier armourers_workshop pesait 516 Mo dans l'instance, dont 545 Mo (*) de
  // skin-cache - un cache que le mod retelecharge tout seul depuis le serveur, donc du
  // poids pur pour le joueur. Seule skin-library compte : 2,5 Mo de skins .armour, qui
  // sont du contenu du pack. Le dossier parent n'etait ni dans DOSSIERS ni dans EXCLUS :
  // il disparaissait sans que rien ne le signale.
  // (*) les deux mesures ne s'additionnent pas, du a l'arrondi de du -sh.
  'armourers_workshop/skin-library',
];

// Fichiers racine a distribuer tels quels.
const FICHIERS_RACINE = ['custom-log4j2.xml'];

// Poses une seule fois, jamais ecrases ensuite : ils contiennent nos reglages mais aussi
// ceux du joueur (sa resolution, son volume). Le launcher offre un bouton pour les
// reappliquer volontairement.
const GRAINES = ['options.txt', 'servers.dat'];

// Jamais distribue : donnees personnelles, journaux, mondes, caches.
const EXCLUS = new Set([
  'saves', 'logs', 'crash-reports', 'screenshots', 'backups', 'downloads',
  'journeymap', 'xaero', 'XaeroWaypoints_BACKUP240807', 'modernfix',
  'Distant_Horizons_server_data', 'server-resource-packs', 'schematics', 'ldlib',
  '.mixin.out', '.cache', '.curseclient', '.qmenu_opened.marker',
  'armourers_workshop',  // seul skin-library est pris, voir DOSSIERS : skin-cache = 545 Mo de cache
  'usercache.json', 'usernamecache.json', 'realms_persistence.json',
  'launcher_accounts.json', 'minecraftinstance.json', 'user-prefs.json',
  'emi.json', 'imgui.ini', 'servers.dat_old', 'EffekseerNativeForJava.dll',
  'versions', 'libraries', 'assets', 'natives',
]);

function sha1(fichier) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(fichier));
  return h.digest('hex');
}

/**
 * Nom plat et unique pour un asset de release : mods/x.jar -> mods__x.jar
 * GitHub remplace les espaces par des points dans le nom des assets : on les retire
 * nous-memes, sinon le manifeste ne retrouverait plus le fichier.
 */
const aplatir = (rel) => rel
  .replace(/[\\/]/g, '__')
  .replace(/ /g, '-')
  // Les accents et tout caractere non-ASCII sont retires.
  // Releve a l'envoi : "emotes/Celebração do GOAT.emotecraft" etait refuse par GitHub,
  // et 7 autres fichiers avec lui. Un asset dont le nom est mange a l'envoi ne serait
  // plus retrouve par le manifeste : le joueur aurait un 404 sur ce seul fichier, a
  // l'installation, sans que rien ne l'ait annonce a la publication.
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9._-]/g, '-');

/**
 * Une fois DANS un dossier de DOSSIERS, on prend tout. EXCLUS ne sert qu'a documenter ce
 * qu'on laisse a la racine de l'instance : l'appliquer en profondeur retirait
 * config/fancymenu/assets (3,5 Mo de design), config/xaero (reglages de minicarte),
 * config/worldedit/schematics - des noms parfaitement legitimes une fois imbriques.
 *
 * Seuls les dossiers caches sautent : ce sont des caches que les mods regenerent
 * (mods/.connector, config/worldedit/.archive-unpack).
 */
/* Les journaux sautent OU QU'ILS SOIENT, pas seulement dans logs/.
   Releve dans l'instance reelle : config/mobengine/debug.log pesait 6,5 Mo de traces
   de tick. EXCLUS ne regarde que la racine, donc ce fichier partait chez chaque
   joueur - du poids pur, et le detail de mes sessions de mise au point. */
const estJournal = (nom) => /\.(log|log\.\d+|log\.gz)$/i.test(nom);

function parcourir(racine, sousDossier, sortie) {
  const abs = path.join(racine, sousDossier);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = path.posix.join(sousDossier.replace(/\\/g, '/'), e.name);
    if (e.isDirectory()) parcourir(racine, path.join(sousDossier, e.name), sortie);
    else if (e.isFile() && !estJournal(e.name)) sortie.push(rel);
  }
}

function main() {
  const instance = process.argv[2];
  const version = process.argv[3] || '1.0.0';
  if (!instance || !fs.existsSync(instance)) {
    console.error('Usage : node outils/faire-manifeste.js "<dossier de l\'instance>" <version>');
    process.exit(1);
  }

  const dist = path.join(__dirname, '..', 'distribution');
  const plat = path.join(dist, 'fichiers');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(plat, { recursive: true });

  const fichiers = [];
  for (const d of DOSSIERS) parcourir(instance, d, fichiers);
  for (const f of FICHIERS_RACINE) if (fs.existsSync(path.join(instance, f))) fichiers.push(f);
  for (const g of GRAINES) if (fs.existsSync(path.join(instance, g))) fichiers.push(g);

  const entrees = [];
  let octets = 0;
  for (const rel of fichiers) {
    const src = path.join(instance, rel);
    const taille = fs.statSync(src).size;
    const empreinte = sha1(src);
    const asset = aplatir(rel);
    entrees.push({
      chemin: rel,
      taille,
      sha1: empreinte,
      asset,
      // une graine n'est posee que si le joueur ne l'a pas : on ne l'ecrase jamais
      graine: GRAINES.includes(rel) || undefined,
    });
    fs.copyFileSync(src, path.join(plat, asset));
    octets += taille;
    if (entrees.length % 40 === 0) process.stdout.write('.');
  }

  const manifeste = {
    nom: 'Epicfight Side',
    version,
    genere: new Date().toISOString(),
    minecraft: '1.20.1',
    forge: '47.4.13',
    // Le launcher remplace <BASE> par l'URL de la release avant de telecharger.
    // Tag fixe : le pack se republie sur le meme tag, sans toucher aux releases
    // du launcher. Voir la note dans electron/config.js.
    base: 'https://github.com/Mouyouu/epicfight-side-launcher/releases/download/pack/',
    total: { fichiers: entrees.length, octets },
    fichiers: entrees,
  };

  fs.writeFileSync(path.join(dist, 'manifeste.json'), JSON.stringify(manifeste, null, 1));

  // archive de secours : utile pour une premiere installation manuelle
  const zip = path.join(dist, 'pack-complet.zip');
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${plat}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`],
      { stdio: 'inherit' });
  } catch {
    console.warn('\n(archive zip non creee — Compress-Archive indisponible)');
  }

  const mo = (n) => (n / 1048576).toFixed(0) + ' Mo';
  console.log(`\n\nVersion ${version}`);
  console.log(`  ${entrees.length} fichiers, ${mo(octets)}`);
  console.log(`  manifeste : ${path.join(dist, 'manifeste.json')}`);
  console.log(`  a envoyer : ${plat}`);
  console.log('\nPublier sur GitHub :');
  console.log(`  gh release create v${version} "${plat}\\*" "${path.join(dist, 'manifeste.json')}" \\`);
  console.log(`     --title "Pack ${version}" --notes "Mise a jour du pack"`);
  console.log('\nPuis corriger le champ "base" du manifeste avec ton depot reel,');
  console.log('et reporter la meme URL dans electron/config.js (MANIFESTE_URL).');
}

main();
