/**
 * Les packs d'automatisation, hors de toute fenêtre (SPEC §8.5) : lire un fichier et en faire le résumé, l'importer, l'activer ou le
 * désactiver, le retirer, l'exporter de nouveau ; exporter des créations de l'atelier en pack. La fenêtre des packs (apps/packs.mjs)
 * et les fonctions de test (`api.mcp`) passent par ici.
 *
 * Les règles d'un pack vont dans le réglage monde `packs` (une table par pack), jamais mêlées aux créations ; ses items éventuels
 * (un pack exporté par l'atelier peut porter les items de ses créations) vont dans le compendium Homebrew, dans un dossier au nom du
 * pack, marqués `flags.darsh-homebrew.pack`.
 */
import { MODULE_ID, log } from "../shared.mjs";
import { compileTable, suggestIdentifier } from "../core/creations.mjs";
import { parseJson, summarizeImport, withPack, withoutPack, withEnabled, packStatus, buildPack, packToJson, packFileName, ENGINE_ID } from "../core/packs.mjs";
import { readStore, readPacks, savePacks } from "../adapter/store.mjs";
import { homebrewPack } from "../adapter/compendium.mjs";
import * as engine from "../adapter/engine.mjs";

/** Le résumé d'un fichier pack (texte JSON ou objet), vu ce monde. */
export function previewPack(input) {
  const { raw, errors } = (typeof input === "string") ? parseJson(input) : { raw: input, errors: [] };
  if ( errors.length ) return { pack: null, errors, ruleErrors: {}, warnings: [], canImport: false };
  return summarizeImport(raw, {
    engine: engine.validators(), store: readPacks(), env: engine.environment(),
    creations: Object.keys(readStore().entries), builtin: engine.builtinIds()
  });
}

/**
 * Importe (ou met à jour) un pack. Refusé s'il a la moindre erreur. Les items qu'il porte sont créés dans le compendium Homebrew ;
 * ceux d'une version précédente du même pack sont remplacés.
 * @returns {Promise<{imported: boolean, summary: object, items: number}>}
 */
export async function importPack(input) {
  const summary = previewPack(input);
  if ( !summary.canImport ) return { imported: false, summary, items: 0 };
  const { pack } = summary;
  const documents = pack.items?.documents ?? [];
  const stored = { ...pack };
  delete stored.items;   // les items vivent dans le compendium, pas dans le réglage
  const items = await replaceItems(pack.id, pack.title, documents);
  if ( items !== null ) stored.itemCount = items;
  await savePacks(withPack(readPacks(), stored, { importedAt: Date.now() }));
  log.info(`pack ${pack.id} ${pack.version} imported (${summary.ruleCount} rule(s), ${items ?? 0} item(s))`);
  return { imported: true, summary, items: items ?? 0 };
}

/** Active ou désactive un pack importé. */
export async function setPackEnabled(id, enabled) {
  if ( !readPacks().packs[id] ) return false;
  await savePacks(withEnabled(readPacks(), id, enabled));
  return true;
}

/** Retire un pack ; ses items restent dans le compendium, sauf `deleteItems`. */
export async function removePack(id, { deleteItems=false }={}) {
  if ( !readPacks().packs[id] ) return false;
  if ( deleteItems ) await replaceItems(id, null, []);
  await savePacks(withoutPack(readPacks(), id));
  return true;
}

/** Les packs importés, avec leur état dans ce monde (sérialisable). */
export function listPacks() {
  const env = engine.environment();
  const registered = engine.registered();
  return Object.values(readPacks().packs).sort((a, b) => a.pack.id.localeCompare(b.pack.id)).map(rec => {
    const { pack } = rec;
    return {
      id: pack.id, title: pack.title, version: pack.version, authors: pack.authors, license: pack.license,
      enabled: rec.enabled, importedAt: rec.importedAt, ruleCount: Object.keys(pack.rules).length,
      sourceCount: Object.keys(pack.sources ?? {}).length, itemCount: pack.itemCount ?? 0, modules: pack.requires?.modules ?? [],
      ...packStatus(rec, env), registered: registered[`pack:${pack.id}`] ?? []
    };
  });
}

/** Le fichier d'un pack importé (avec ses items, s'il en avait), pour l'exporter de nouveau : `{ name, text }`. */
export async function exportImportedPack(id) {
  const rec = readPacks().packs[id];
  if ( !rec ) return null;
  const { itemCount, ...pack } = rec.pack;
  const documents = itemCount ? await itemsOf(id) : [];
  const out = { ...pack, ...(documents.length ? { items: { documents } } : {}) };
  return { name: packFileName(out), text: packToJson(out) };
}

/**
 * Un pack tiré de créations de l'atelier : leurs règles (base gardée et recettes, compilées et validées par le moteur), et, si
 * demandé, leurs items. Une création en erreur, ou sans règle, n'y va pas (dite dans `skipped`).
 * @returns {Promise<{name: string, text: string, pack: object, skipped: Record<string, string[]>}>}
 */
export async function exportCreations({ identifiers, id, title, version="1.0.0", authors, license="MIT", includeItems=true }) {
  const all = readStore();
  const chosen = { v: all.v, entries: Object.fromEntries((identifiers ?? Object.keys(all.entries)).filter(i => all.entries[i]).map(i => [i, all.entries[i]])) };
  const { table, errors } = compileTable(chosen, engine.build, engine.validate);
  const skipped = { ...errors };
  for ( const i of Object.keys(chosen.entries) ) if ( !table[i] && !skipped[i] ) skipped[i] = ["no rule"];
  const documents = [];
  if ( includeItems ) for ( const i of Object.keys(table) ) {
    const item = chosen.entries[i].uuid ? await fromUuid(chosen.entries[i].uuid) : null;
    if ( item ) documents.push(cleanDocument(item.toObject()));
  }
  const env = engine.environment();
  const pack = buildPack({
    id: id || suggestIdentifier(title) || "homebrew-pack", title: title || id, version,
    authors: authors ?? [game.user.name], license, contentVersion: env.contentVersion,
    engineRange: `>=${env.engineVersion}`, rules: table, documents
  });
  return { name: packFileName(pack), text: packToJson(pack), pack, skipped };
}

/** Donne un fichier à enregistrer au navigateur. */
export function download({ name, text }) {
  foundry.utils.saveDataToFile(text, "application/json", name);
}

/* -------------------------------------------------------------------------------------------------------------------------- */

/** Ce qu'un item exporté ne garde pas : son rangement dans ce monde et ce qui identifie sa source. Les ids (item, activités, effets) restent. */
function cleanDocument(data) {
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  delete data._stats;
  if ( data.flags ) {
    delete data.flags.babele;
    delete data.flags[ENGINE_ID];
    delete data.flags.core?.sourceId;
    if ( data.flags[MODULE_ID] ) { delete data.flags[MODULE_ID].pack; delete data.flags[MODULE_ID].creation; }
  }
  return data;
}

/** Les items d'un pack dans le compendium Homebrew. */
async function itemsOf(id) {
  const pack = homebrewPack();
  if ( !pack ) return [];
  const docs = await pack.getDocuments();
  return docs.filter(d => d.getFlag(MODULE_ID, "pack") === id).map(d => cleanDocument(d.toObject()));
}

/**
 * Remplace les items d'un pack dans le compendium Homebrew par `documents` (vide : les retire, et leur dossier). Les ids sont
 * gardés quand ils sont libres (les règles et les sources du pack peuvent y renvoyer). @returns {Promise<number|null>} le nombre
 * d'items créés, ou null sans compendium.
 */
async function replaceItems(id, title, documents) {
  const pack = homebrewPack();
  if ( !pack ) {
    if ( documents.length ) log.warn(`pack ${id}: ${documents.length} item(s) not created, Homebrew compendium missing`);
    return null;
  }
  const docs = await pack.getDocuments();
  const old = docs.filter(d => d.getFlag(MODULE_ID, "pack") === id).map(d => d.id);
  if ( old.length ) await Item.implementation.deleteDocuments(old, { pack: pack.collection });
  let folder = pack.folders.find(f => f.getFlag(MODULE_ID, "pack") === id) ?? null;
  if ( !documents.length ) {
    if ( folder ) await folder.delete();
    return 0;
  }
  folder ??= await Folder.implementation.create({ name: title ?? id, type: "Item", flags: { [MODULE_ID]: { pack: id } } }, { pack: pack.collection });
  const taken = new Set(pack.index.map(e => e._id));
  const data = documents.map(d => {
    const doc = cleanDocument(structuredClone(d));
    if ( doc._id && taken.has(doc._id) ) delete doc._id;
    doc.folder = folder?.id ?? null;
    foundry.utils.setProperty(doc, `flags.${MODULE_ID}.pack`, id);
    return doc;
  });
  const keep = data.filter(d => d._id);
  const fresh = data.filter(d => !d._id);
  const created = [
    ...(keep.length ? await Item.implementation.createDocuments(keep, { pack: pack.collection, keepId: true, keepEmbeddedIds: true }) : []),
    ...(fresh.length ? await Item.implementation.createDocuments(fresh, { pack: pack.collection, keepEmbeddedIds: true }) : [])
  ];
  return created.length;
}
