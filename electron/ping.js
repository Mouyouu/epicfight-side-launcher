'use strict';

/**
 * Etat du serveur par le protocole natif de Minecraft (Server List Ping), exactement
 * ce que fait le client dans sa liste de serveurs. Aucun service tiers : on interroge
 * le serveur directement, donc pas d'intermediaire qui puisse tomber ou mentir.
 *
 * Sequence : Handshake (etat 1) -> Status Request -> Status Response (JSON) -> Ping.
 */
const net = require('net');

/** Entier a longueur variable, le format de nombre du protocole Minecraft. */
function varint(n) {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    o.push(b);
  } while (n !== 0);
  return Buffer.from(o);
}

function lireVarint(buf, pos) {
  let valeur = 0, decalage = 0, octet;
  do {
    if (pos >= buf.length) return null;          // paquet incomplet
    octet = buf[pos++];
    valeur |= (octet & 0x7f) << decalage;
    decalage += 7;
    if (decalage > 35) throw new Error('VarInt trop long');
  } while (octet & 0x80);
  return { valeur, pos };
}

function paquet(id, ...morceaux) {
  const corps = Buffer.concat([varint(id), ...morceaux]);
  return Buffer.concat([varint(corps.length), corps]);
}

function chaine(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

/**
 * @returns {Promise<{enLigne:boolean, joueurs?:number, max?:number, ping?:number, version?:string}>}
 */
function interroger(hote, port, delai = 4000) {
  return new Promise((resoudre) => {
    const debut = Date.now();
    let recu = Buffer.alloc(0);
    let regle = false;

    const fin = (r) => { if (!regle) { regle = true; prise.destroy(); resoudre(r); } };
    const horsLigne = () => fin({ enLigne: false });

    const prise = net.createConnection({ host: hote, port, timeout: delai });
    prise.on('timeout', horsLigne);
    prise.on('error', horsLigne);

    prise.on('connect', () => {
      const port16 = Buffer.alloc(2);
      port16.writeUInt16BE(port);
      // -1 = numero de protocole "je ne sais pas", accepte par tous les serveurs
      prise.write(paquet(0x00, varint(-1 >>> 0), chaine(hote), port16, varint(1)));
      prise.write(paquet(0x00));                 // Status Request
    });

    prise.on('data', (bout) => {
      recu = Buffer.concat([recu, bout]);
      try {
        const entete = lireVarint(recu, 0);
        if (!entete) return;                     // pas encore la longueur
        if (recu.length < entete.pos + entete.valeur) return;   // paquet partiel

        const idp = lireVarint(recu, entete.pos);
        const lon = lireVarint(recu, idp.pos);
        if (!lon || recu.length < lon.pos + lon.valeur) return;

        const json = JSON.parse(recu.slice(lon.pos, lon.pos + lon.valeur).toString('utf8'));
        fin({
          enLigne: true,
          joueurs: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          version: json.version?.name ?? null,
          ping: Date.now() - debut,
        });
      } catch {
        horsLigne();
      }
    });
  });
}

module.exports = { interroger };
