'use strict';

/**
 * Installe Minecraft, Forge et Java depuis les sources officielles.
 *
 * C'est la difference majeure avec l'ancien launcher, qui supposait le jeu deja present
 * et devait donc distribuer 2,6 Go. Ici on ne distribue que nos 739 Mo : le client, ses
 * bibliotheques, ses ressources et Forge viennent de chez Mojang et MinecraftForge, a
 * leurs frais, et chaque fichier porte son sha1 dans le manifeste officiel.
 *
 *   piston-meta.mojang.com/mc/game/version_manifest_v2.json  -> trouve la version
 *   client.json                                              -> libraries + assetIndex
 *   resources.download.minecraft.net/<2 car.>/<hash>         -> les ressources
 *   maven.minecraftforge.net                                 -> l'installateur Forge
 *   api.adoptium.net                                         -> le JRE 17
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { json, fichier, sha1Local, enParallele } = require('./reseau');
const { MINECRAFT, FORGE } = require('./config');

const MANIFESTE_VERSIONS = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESSOURCES = 'https://resources.download.minecraft.net/';
const MAVEN_FORGE = 'https://maven.minecraftforge.net/net/minecraftforge/forge/';
const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest/17/hotspot'
               + '?architecture=x64&image_type=jre&os=windows&vendor=eclipse';

const estWindows = process.platform === 'win32';

/** Les regles "allow/disallow" d'une bibliotheque selon le systeme. */
function autorisee(lib) {
  if (!lib.rules) return true;
  let ok = false;
  for (const r of lib.rules) {
    const vise = !r.os || r.os.name === (estWindows ? 'windows'
                : process.platform === 'darwin' ? 'osx' : 'linux');
    if (vise) ok = r.action === 'allow';
  }
  return ok;
}

/** Chemin local d'une bibliotheque a partir de son nom Maven. */
function cheminLib(nom, racine) {
  const [groupe, artefact, version, classifieur] = nom.split(':');
  const suffixe = classifieur ? `-${classifieur}` : '';
  return path.join(racine, 'libraries', ...groupe.split('.'), artefact, version,
                   `${artefact}-${version}${suffixe}.jar`);
}

/** Telecharge le client, ses bibliotheques et ses ressources. */
async function installerMinecraft(racine, progression) {
  const dire = (t) => progression && progression({ etape: 'minecraft', detail: t });

  dire('recherche de la version');
  const versions = await json(MANIFESTE_VERSIONS);
  const entree = versions.versions.find((v) => v.id === MINECRAFT);
  if (!entree) throw new Error(`Version ${MINECRAFT} introuvable chez Mojang`);

  const dossierV = path.join(racine, 'versions', MINECRAFT);
  fs.mkdirSync(dossierV, { recursive: true });
  const cheminJson = path.join(dossierV, `${MINECRAFT}.json`);
  if (!fs.existsSync(cheminJson)) await fichier(entree.url, cheminJson, { sha1: entree.sha1 });
  const client = JSON.parse(fs.readFileSync(cheminJson, 'utf8'));

  dire('client');
  const jar = path.join(dossierV, `${MINECRAFT}.jar`);
  if (sha1Local(jar) !== client.downloads.client.sha1) {
    await fichier(client.downloads.client.url, jar, { sha1: client.downloads.client.sha1 });
  }

  dire('bibliothèques');
  const libs = client.libraries.filter(autorisee);
  await enParallele(libs.map((l) => async () => {
    const a = l.downloads && l.downloads.artifact;
    if (!a) return;
    const dest = path.join(racine, 'libraries', a.path);
    if (sha1Local(dest) === a.sha1) return;
    await fichier(a.url, dest, { sha1: a.sha1 });
  }), 8);

  dire('index des ressources');
  const idx = path.join(racine, 'assets', 'indexes', `${client.assetIndex.id}.json`);
  if (sha1Local(idx) !== client.assetIndex.sha1) {
    await fichier(client.assetIndex.url, idx, { sha1: client.assetIndex.sha1 });
  }
  const objets = JSON.parse(fs.readFileSync(idx, 'utf8')).objects;
  const liste = Object.values(objets);

  let fait = 0;
  await enParallele(liste.map((o) => async () => {
    const sous = o.hash.slice(0, 2);
    const dest = path.join(racine, 'assets', 'objects', sous, o.hash);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== o.size) {
      await fichier(RESSOURCES + sous + '/' + o.hash, dest, { sha1: o.hash });
    }
    if (++fait % 200 === 0) {
      progression && progression({ etape: 'ressources', fait, total: liste.length });
    }
  }), 12);

  return { assetIndex: client.assetIndex.id, client };
}

/**
 * Installe Forge en lancant son installateur officiel en mode client.
 * L'installateur sait construire le profil de version et patcher le jar : le refaire
 * a la main serait fragile a chaque revision de Forge.
 */
async function installerForge(racine, java, progression) {
  const complet = `${MINECRAFT}-${FORGE}`;
  const idForge = `${MINECRAFT}-forge-${FORGE}`;
  const dejaLa = path.join(racine, 'versions', idForge, `${idForge}.json`);
  if (fs.existsSync(dejaLa)) return idForge;

  progression && progression({ etape: 'forge', detail: 'téléchargement' });
  const url = `${MAVEN_FORGE}${complet}/forge-${complet}-installer.jar`;
  const installeur = path.join(os.tmpdir(), `forge-${complet}-installer.jar`);
  await fichier(url, installeur);

  // L'installateur exige un launcher_profiles.json, meme vide.
  const profils = path.join(racine, 'launcher_profiles.json');
  if (!fs.existsSync(profils)) fs.writeFileSync(profils, '{"profiles":{}}');

  progression && progression({ etape: 'forge', detail: 'installation' });
  await new Promise((resoudre, rejeter) => {
    execFile(java, ['-jar', installeur, '--installClient', racine],
      { windowsHide: true, maxBuffer: 1 << 24 }, (err, _out, errOut) => {
        if (err) return rejeter(new Error('Installation de Forge : ' + (errOut || err.message)));
        resoudre();
      });
  });

  if (!fs.existsSync(dejaLa)) throw new Error('Forge installé mais profil introuvable');
  return idForge;
}

/** Telecharge un JRE 17 Temurin si le launcher n'en a pas deja un. */
async function installerJava(racine, progression) {
  const base = path.join(racine, 'runtime', 'jre17');
  const exe = path.join(base, 'bin', estWindows ? 'javaw.exe' : 'java');
  if (fs.existsSync(exe)) return exe;

  progression && progression({ etape: 'java', detail: 'téléchargement' });
  const [paquet] = await json(ADOPTIUM);
  if (!paquet) throw new Error('Aucun JRE 17 disponible pour ce système');

  const zip = path.join(os.tmpdir(), 'jre17.zip');
  await fichier(paquet.binary.package.link, zip, { sha1: paquet.binary.package.checksum });

  progression && progression({ etape: 'java', detail: 'extraction' });
  fs.mkdirSync(base, { recursive: true });
  await new Promise((resoudre, rejeter) => {
    execFile('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${base}' -Force`],
      { windowsHide: true }, (e) => (e ? rejeter(e) : resoudre()));
  });

  // L'archive contient un dossier jdk-17.x : on remonte son contenu d'un cran.
  const dedans = fs.readdirSync(base);
  if (dedans.length === 1 && fs.statSync(path.join(base, dedans[0])).isDirectory()) {
    const inter = path.join(base, dedans[0]);
    for (const e of fs.readdirSync(inter)) fs.renameSync(path.join(inter, e), path.join(base, e));
    fs.rmdirSync(inter);
  }
  if (!fs.existsSync(exe)) throw new Error('JRE extrait mais javaw introuvable');
  return exe;
}

/**
 * Extrait les bibliotheques natives (lwjgl.dll, glfw.dll...) dans jeu/natives.
 *
 * POURQUOI CETTE FONCTION EXISTE
 * Elle manquait. Le launcher creait bien le dossier natives et passait
 * -Djava.library.path dessus, mais rien ne le remplissait jamais. Les 21 jars
 * "-natives-windows" etaient telecharges puis ignores, et le jeu s'arretait sur :
 *   java.lang.UnsatisfiedLinkError: Failed to locate library: lwjgl.dll
 *
 * COMMENT ON CHOISIT LE BON JAR
 * En 1.20.1, les trois variantes Windows portent des regles IDENTIQUES :
 *   org.lwjgl:lwjgl:3.3.1:natives-windows        -> rules: [{allow, os windows}]
 *   org.lwjgl:lwjgl:3.3.1:natives-windows-arm64  -> rules: [{allow, os windows}]
 *   org.lwjgl:lwjgl:3.3.1:natives-windows-x86    -> rules: [{allow, os windows}]
 * Les regles ne permettent donc pas de trancher : c'est le SUFFIXE DU NOM qui porte
 * l'architecture. Se fier aux regles seules extrairait les trois par-dessus les autres,
 * et le jeu chargerait une dll ARM sur une machine x64.
 *
 * L'extraction passe par .NET via PowerShell, en un seul appel pour tous les jars :
 * Node n'a pas de decompression integree, et lancer 21 processus serait inutilement lent.
 */
function extraireNatives(racine, chaine) {
  const dossier = path.join(racine, 'natives');
  fs.mkdirSync(dossier, { recursive: true });

  const suffixe = ':natives-' + (estWindows ? 'windows' : 'linux')
    + (process.arch === 'arm64' ? '-arm64' : process.arch === 'ia32' ? '-x86' : '');

  const jars = [];
  for (const profil of chaine) {
    for (const lib of profil.libraries || []) {
      if (!lib.name || !lib.name.includes(':natives-')) continue;
      if (!lib.name.endsWith(suffixe) || !autorisee(lib)) continue;
      const relatif = lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path;
      const abs = relatif ? path.join(racine, 'libraries', relatif) : cheminLib(lib.name, racine);
      if (fs.existsSync(abs) && !jars.includes(abs)) jars.push(abs);
    }
  }
  if (!jars.length) return 0;

  const liste = path.join(os.tmpdir(), 'natives-' + Date.now() + '.txt');
  fs.writeFileSync(liste, jars.join('\n'), 'utf8');
  execFileSync('powershell', ['-NoProfile', '-Command', `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $dest = '${dossier.replace(/'/g, "''")}'
    foreach ($j in Get-Content -LiteralPath '${liste.replace(/'/g, "''")}') {
      if (-not $j) { continue }
      $z = [System.IO.Compression.ZipFile]::OpenRead($j)
      foreach ($e in $z.Entries) {
        if ($e.Name -match '\\.(dll|so|dylib)$' -and $e.FullName -notlike 'META-INF/*') {
          [System.IO.Compression.ZipFileExtensions]::ExtractToFile(
            $e, (Join-Path $dest $e.Name), $true)
        }
      }
      $z.Dispose()
    }`], { windowsHide: true, stdio: 'ignore' });
  try { fs.unlinkSync(liste); } catch { /* sans importance */ }

  return fs.readdirSync(dossier).filter((f) => /\.(dll|so|dylib)$/i.test(f)).length;
}

module.exports = {
  installerMinecraft, installerForge, installerJava, extraireNatives, cheminLib, autorisee,
};
