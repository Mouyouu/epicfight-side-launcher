'use strict';

/**
 * Compare l'instance de jeu au manifeste et liste TOUT ce qui n'est pas distribue.
 * A lancer apres chaque faire-manifeste.js : c'est le filet qui attrape un dossier de
 * design ajoute par un nouveau mod et qu'on aurait oublie de declarer.
 *
 *   node outils/verifier-oublis.js "<dossier de l'instance>"
 */
const fs = require('fs');
const path = require('path');

// Volontairement hors distribution : donnees du joueur, caches, et le jeu lui-meme
// (telecharge depuis les serveurs officiels).
const ATTENDU_ABSENT = new Set([
  'saves', 'logs', 'crash-reports', 'screenshots', 'backups', 'downloads',
  'xaero', 'xaerowaypoints_backup240807', 'modernfix', 'distant_horizons_server_data',
  'server-resource-packs', '.mixin.out', '.cache', '.curseclient', '.qmenu_opened.marker',
  'versions', 'libraries', 'assets', 'natives', 'schematics', 'ldlib',
  'usercache.json', 'usernamecache.json', 'minecraftinstance.json', 'user-prefs.json',
  'emi.json', 'imgui.ini', 'servers.dat_old', 'effekseernativeforjava.dll',
]);

const instance = process.argv[2];
if (!instance || !fs.existsSync(instance)) {
  console.error('Usage : node outils/verifier-oublis.js "<dossier de l\'instance>"');
  process.exit(1);
}

const manifeste = require(path.join(__dirname, '..', 'distribution', 'manifeste.json'));
const distribues = new Set(manifeste.fichiers.map((f) => f.chemin.toLowerCase()));

const oublis = [];
(function scan(rel) {
  const abs = path.join(instance, rel || '.');
  let entrees;
  try { entrees = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entrees) {
    const r = rel ? rel + '/' + e.name : e.name;
    // au premier niveau seulement : ce qu'on a decide de ne pas distribuer
    if (!rel && ATTENDU_ABSENT.has(e.name.toLowerCase())) continue;
    if (e.isDirectory()) scan(r);
    else if (e.isFile() && !distribues.has(r.toLowerCase())) {
      let taille = 0;
      try { taille = fs.statSync(path.join(instance, r)).size; } catch { /* ignore */ }
      oublis.push([taille, r]);
    }
  }
})('');

oublis.sort((a, b) => b[0] - a[0]);
const total = oublis.reduce((s, x) => s + x[0], 0);

console.log(`Manifeste : ${manifeste.total.fichiers} fichiers, ` +
            `${(manifeste.total.octets / 1048576).toFixed(1)} Mo\n`);
if (!oublis.length) {
  console.log('Rien d\'autre a distribuer : tout est pris en compte.');
} else {
  console.log(`${oublis.length} fichier(s) non distribue(s), ${(total / 1048576).toFixed(1)} Mo :\n`);
  for (const [t, r] of oublis.slice(0, 40)) {
    console.log(`  ${(t / 1024).toFixed(0).padStart(8)} Ko  ${r}`);
  }
  if (oublis.length > 40) console.log(`  ... et ${oublis.length - 40} autres`);
  console.log('\nChacun doit avoir une raison : soit c\'est une donnee du joueur, soit il');
  console.log('manque un dossier dans DOSSIERS de faire-manifeste.js.');
}
