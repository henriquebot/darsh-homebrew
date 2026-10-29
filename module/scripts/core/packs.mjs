/**
 * Les packs d'automatisation importés, sans Foundry (SPEC §5, §7, §8.5) : lecture et contrôle d'un fichier pack, rangement dans le
 * monde, état (actif ou non, et pourquoi), ordre d'enregistrement auprès du moteur, conflits, export.
 *
 * Un pack est un fichier JSON qui ne porte que des règles, indexées par identifiant dnd5e :
 *   { format: "das-pack", formatVersion: 1, id, title, version, authors, license, contentVersion,
 *     requires: { "dnd5e-combat": ">=0.267.0", modules: [] }, sources: { idDocument: identifiant }, rules: { identifiant: entrée },
 *     items?: { documents: [] } }
 *
 * Rangement (réglage monde `packs`, à part des créations) :
 *   { v: 1, packs: { <id>: { pack, enabled, importedAt } } }
 *
 * Fonctions pures : la validation d'une entrée et d'une table de sources est passée en argument (celle du moteur), pour que ce module
 * ne connaisse pas le schéma. Les problèmes sont rendus en `{ code, data }`, traduits par l'interface (`DHB.Paquet.Erreur.<code>`).
 */
import { isIdentifier } from "./creations.mjs";

export const PACK_FORMAT = "das-pack";
export const FORMAT_VERSION = 1;
export const PACKS_STORE_VERSION = 1;
/** La source sous laquelle un pack importé est enregistré auprès du moteur (provenance lisible : « pack:mon-pack »). */
export const SOURCE_PREFIX = "pack:";
export const ENGINE_ID = "dnd5e-combat";

/**
 * Migrations du format, d'une version à la suivante : `{ 1: pack => pack au format 2 }`. Vide tant que le format n'a qu'une version ;
 * un fichier d'une version plus ancienne sans migration, ou plus récente que celle de l'atelier, est refusé.
 */
export const FORMAT_MIGRATIONS = Object.freeze({});

/** Les codes des problèmes (une clé de traduction chacun, tests/lang.test.mjs). */
export const ISSUE_CODES = Object.freeze([
  "NotJson", "NotObject", "Format", "FormatVersion", "FormatNewer", "FormatNoMigration", "Id", "Title", "Version", "Authors",
  "License", "ContentVersion", "Requires", "EngineRange", "Modules", "Sources", "Rules", "RulesEmpty", "Items",
  "UnknownKey"
]);

/** Les raisons pour lesquelles un pack enregistré n'agit pas (ou agit en partie). */
export const STATUS_CODES = Object.freeze(["Disabled", "MissingModules", "ContentVersion", "EngineVersion", "SourcesUnsupported"]);

const KNOWN_KEYS = ["format", "formatVersion", "id", "title", "version", "authors", "license", "contentVersion", "requires", "sources", "rules", "items", "animations"];
const isObject = v => (typeof v === "object") && (v !== null) && !Array.isArray(v);
const issue = (code, data={}) => ({ code, data });
const isDocId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  Versions                                                                                                                  */
/* -------------------------------------------------------------------------------------------------------------------------- */

/** « 1.2.0 » → [1, 2, 0] ; une version incomplète est complétée (« 1.2 » → [1, 2, 0]) ; un suffixe « -beta » est ignoré. */
export function parseVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** -1, 0, 1 ; une version illisible compte comme la plus petite. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a) ?? [-1, -1, -1], parseVersion(b) ?? [-1, -1, -1]];
  for ( let i = 0; i < 3; i++ ) if ( x[i] !== y[i] ) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Une contrainte lisible : vide, « * », ou des termes `>=x.y.z`, `>`, `<=`, `<`, `=` (ou une version seule) séparés par des espaces. */
export function isRange(range) {
  if ( (typeof range !== "string") ) return false;
  const terms = range.trim().split(/\s+/).filter(Boolean);
  return terms.every(t => (t === "*") || !!t.match(/^(>=|<=|>|<|=)?\s*(.+)$/) && !!parseVersion(t.replace(/^(>=|<=|>|<|=)/, "")));
}

/** La version satisfait-elle la contrainte ? (« >=0.200.0 <1.0.0 ») */
export function satisfies(version, range) {
  if ( !parseVersion(version) ) return false;
  const terms = String(range ?? "").trim().split(/\s+/).filter(t => t && (t !== "*"));
  return terms.every(t => {
    const [, op="=", v] = t.match(/^(>=|<=|>|<|=)?(.+)$/);
    const c = compareVersions(version, v);
    return { ">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c === 0 }[op];
  });
}

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  Lecture d'un fichier                                                                                                      */
/* -------------------------------------------------------------------------------------------------------------------------- */

/** Le texte d'un fichier en objet : `{ raw, errors }`. */
export function parseJson(text) {
  try { return { raw: JSON.parse(text), errors: [] }; }
  catch(err) { return { raw: null, errors: [issue("NotJson", { message: err.message })] }; }
}

/**
 * Amène un pack au format courant, par les migrations (`FORMAT_MIGRATIONS`). @returns {{pack: object|null, errors: object[]}}
 */
export function migratePack(raw, migrations=FORMAT_MIGRATIONS, current=FORMAT_VERSION) {
  if ( !isObject(raw) ) return { pack: null, errors: [issue("NotObject")] };
  if ( raw.format !== PACK_FORMAT ) return { pack: null, errors: [issue("Format", { format: String(raw.format ?? "") })] };
  let v = raw.formatVersion;
  if ( !Number.isInteger(v) || (v < 1) ) return { pack: null, errors: [issue("FormatVersion")] };
  if ( v > current ) return { pack: null, errors: [issue("FormatNewer", { version: v, current })] };
  let pack = structuredClone(raw);
  while ( v < current ) {
    const step = migrations[v];
    if ( typeof step !== "function" ) return { pack: null, errors: [issue("FormatNoMigration", { version: v })] };
    pack = { ...step(pack), formatVersion: v + 1 };
    v += 1;
  }
  return { pack, errors: [] };
}

/** Une table de sources contrôlée ici quand le moteur n'en a pas (avant §277) : mêmes règles. */
function localSourceErrors(sources) {
  if ( !isObject(sources) ) return ["sources: an object { document id: identifier } expected"];
  return Object.entries(sources).flatMap(([k, v]) => [
    ...(isDocId(k) ? [] : [`sources.${k}: document id (16 characters) expected`]),
    ...(isIdentifier(v) ? [] : [`sources.${k}: kebab-case identifier expected`])
  ]);
}

/**
 * Lit un pack (objet déjà tiré du JSON) : format, champs, sources, et chaque règle validée par le moteur.
 * @param {object} raw
 * @param {{validate: (entry: object) => string[], validateSources?: (sources: object) => string[]}} engine
 * @returns {{pack: object|null, errors: object[], ruleErrors: Record<string, string[]>, warnings: object[]}}
 *   `pack` : la forme rangée (champs connus seulement), même en présence d'erreurs si sa structure est lisible.
 */
export function readPack(raw, { validate, validateSources=localSourceErrors }) {
  const migrated = migratePack(raw);
  if ( !migrated.pack ) return { pack: null, errors: migrated.errors, ruleErrors: {}, warnings: [] };
  const p = migrated.pack;
  const errors = [];
  const warnings = [];
  for ( const key of Object.keys(p) ) if ( !KNOWN_KEYS.includes(key) ) warnings.push(issue("UnknownKey", { key }));

  if ( !isIdentifier(p.id) ) errors.push(issue("Id", { id: String(p.id ?? "") }));
  if ( (typeof p.title !== "string") || !p.title.trim() ) errors.push(issue("Title"));
  if ( !parseVersion(p.version) ) errors.push(issue("Version", { version: String(p.version ?? "") }));
  const authors = (typeof p.authors === "string") ? [p.authors] : p.authors;
  if ( (authors !== undefined) && (!Array.isArray(authors) || authors.some(a => (typeof a !== "string") || !a.trim())) ) errors.push(issue("Authors"));
  if ( (p.license !== undefined) && (typeof p.license !== "string") ) errors.push(issue("License"));
  if ( !Number.isInteger(p.contentVersion) || (p.contentVersion < 1) ) errors.push(issue("ContentVersion"));

  const requires = p.requires ?? {};
  let engineRange = "";
  let modules = [];
  if ( !isObject(requires) ) errors.push(issue("Requires"));
  else {
    for ( const key of Object.keys(requires) ) if ( ![ENGINE_ID, "modules"].includes(key) ) warnings.push(issue("UnknownKey", { key: `requires.${key}` }));
    if ( requires[ENGINE_ID] !== undefined ) {
      if ( isRange(requires[ENGINE_ID]) ) engineRange = requires[ENGINE_ID].trim();
      else errors.push(issue("EngineRange", { range: String(requires[ENGINE_ID]) }));
    }
    if ( requires.modules !== undefined ) {
      if ( Array.isArray(requires.modules) && requires.modules.every(m => (typeof m === "string") && m.trim()) ) modules = [...new Set(requires.modules.map(m => m.trim()))];
      else errors.push(issue("Modules"));
    }
  }

  let sources = {};
  if ( p.sources !== undefined ) {
    const sErrors = validateSources(p.sources);
    if ( sErrors.length ) errors.push(issue("Sources", { errors: sErrors.join(" ; ") }));
    else sources = { ...p.sources };
  }

  const rules = {};
  const ruleErrors = {};
  if ( !isObject(p.rules) ) errors.push(issue("Rules"));
  else {
    if ( !Object.keys(p.rules).length ) errors.push(issue("RulesEmpty"));
    for ( const [id, entry] of Object.entries(p.rules) ) {
      if ( !isIdentifier(id) ) { ruleErrors[id] = [`"${id}": kebab-case identifier expected`]; continue; }
      const errs = isObject(entry) ? validate(entry) : ["the entry is an object"];
      if ( errs.length ) ruleErrors[id] = errs;
      rules[id] = entry;
    }
  }

  let items;
  if ( p.items !== undefined ) {
    if ( !isObject(p.items) || ((p.items.documents !== undefined) && (!Array.isArray(p.items.documents) || p.items.documents.some(d => !isObject(d)))) ) errors.push(issue("Items"));
    else if ( p.items.documents?.length ) items = { documents: structuredClone(p.items.documents) };
  }

  const pack = {
    format: PACK_FORMAT, formatVersion: FORMAT_VERSION,
    id: p.id, title: typeof p.title === "string" ? p.title.trim() : "", version: String(p.version ?? ""),
    authors: Array.isArray(authors) ? authors.map(String) : [], license: typeof p.license === "string" ? p.license : "",
    contentVersion: p.contentVersion,
    requires: { ...(engineRange ? { [ENGINE_ID]: engineRange } : {}), modules },
    sources, rules: structuredClone(rules),
    ...(items ? { items } : {})
  };
  return { pack, errors, ruleErrors, warnings };
}

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  Rangement                                                                                                                 */
/* -------------------------------------------------------------------------------------------------------------------------- */

/** Le rangement, toujours bien formé (un réglage vide ou d'une autre version donne un rangement vide). */
export function normalizePacksStore(raw) {
  if ( !isObject(raw) || (raw.v !== PACKS_STORE_VERSION) || !isObject(raw.packs) ) return { v: PACKS_STORE_VERSION, packs: {} };
  const packs = {};
  for ( const [id, rec] of Object.entries(raw.packs) ) {
    if ( !isObject(rec) || !isObject(rec.pack) || (rec.pack.id !== id) ) continue;
    packs[id] = { pack: rec.pack, enabled: rec.enabled !== false, importedAt: Number.isFinite(rec.importedAt) ? rec.importedAt : 0 };
  }
  return { v: PACKS_STORE_VERSION, packs };
}

/** Le rangement avec ce pack ajouté ou remplacé (une mise à jour garde l'interrupteur du MJ). Ne modifie pas l'original. */
export function withPack(store, pack, { enabled, importedAt=0 }={}) {
  const next = normalizePacksStore(structuredClone(store));
  const previous = next.packs[pack.id];
  next.packs[pack.id] = { pack: structuredClone(pack), enabled: enabled ?? previous?.enabled ?? true, importedAt };
  return next;
}

export function withoutPack(store, id) {
  const next = normalizePacksStore(structuredClone(store));
  delete next.packs[id];
  return next;
}

export function withEnabled(store, id, enabled) {
  const next = normalizePacksStore(structuredClone(store));
  if ( next.packs[id] ) next.packs[id].enabled = !!enabled;
  return next;
}

/**
 * Ce que l'import ferait de ce pack, vu ce qui est déjà rangé : `new`, `update` (version plus récente), `same` (même version :
 * réimport à l'identique), `downgrade` (version plus ancienne : permis, mais dit). @returns {{decision: string, previous: string|null}}
 */
export function importDecision(store, pack) {
  const previous = normalizePacksStore(store).packs[pack.id]?.pack.version ?? null;
  if ( previous === null ) return { decision: "new", previous };
  const c = compareVersions(pack.version, previous);
  return { decision: c > 0 ? "update" : (c === 0 ? "same" : "downgrade"), previous };
}

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  État et enregistrement                                                                                                    */
/* -------------------------------------------------------------------------------------------------------------------------- */

/**
 * Agit-il, et sinon pourquoi ? `env` : `{ engineVersion, contentVersion, isModuleActive(id), sourcesSupported }`.
 * @returns {{active: boolean, reasons: object[], warnings: object[]}}  `reasons` : ce qui le rend inactif ; `warnings` : ce qui
 *   l'affaiblit sans l'arrêter (des sources que le moteur ne sait pas enregistrer).
 */
export function packStatus(record, env) {
  const { pack } = record;
  const reasons = [];
  const warnings = [];
  if ( !record.enabled ) reasons.push(issue("Disabled"));
  const missing = (pack.requires?.modules ?? []).filter(id => !env.isModuleActive(id));
  if ( missing.length ) reasons.push(issue("MissingModules", { modules: missing.join(", ") }));
  if ( pack.contentVersion !== env.contentVersion ) reasons.push(issue("ContentVersion", { pack: pack.contentVersion, engine: env.contentVersion }));
  const range = pack.requires?.[ENGINE_ID];
  if ( range && !satisfies(env.engineVersion, range) ) reasons.push(issue("EngineVersion", { range, version: env.engineVersion }));
  if ( Object.keys(pack.sources ?? {}).length && !env.sourcesSupported ) warnings.push(issue("SourcesUnsupported"));
  return { active: !reasons.length, reasons, warnings };
}

/** La source d'un pack auprès du moteur. */
export const sourceOf = id => `${SOURCE_PREFIX}${id}`;

/**
 * Les packs à enregistrer auprès du moteur, dans l'ordre (SPEC §7) : les packs actifs par ordre alphabétique de leur id — stable d'un
 * client à l'autre —, avant les créations de l'atelier, que l'appelant enregistre ensuite. Le moteur fusionne dans l'ordre des
 * enregistrements : la dernière source l'emporte, clé par clé.
 * @returns {Array<{source: string, id: string, table: object, sources: object}>}
 */
export function registrationPlan(store, env) {
  return Object.values(normalizePacksStore(store).packs)
    .filter(rec => packStatus(rec, env).active)
    .sort((a, b) => a.pack.id.localeCompare(b.pack.id))
    .map(({ pack }) => ({ source: sourceOf(pack.id), id: pack.id, table: pack.rules, sources: pack.sources ?? {} }));
}

/**
 * Les identifiants revendiqués par plusieurs sources, dans l'ordre de fusion : contenu du moteur (`builtin`), packs (dans l'ordre
 * du plan), créations de l'atelier. La dernière source de la liste l'emporte, clé par clé.
 * @param {{plan: Array<{source: string, table: object}>, creations?: string[], creationsSource?: string, builtin?: (id: string) => boolean}} args
 * @returns {Array<{identifier: string, sources: string[]}>}
 */
export function conflicts({ plan, creations=[], creationsSource="creations", builtin=() => false }) {
  const claims = new Map();
  const claim = (id, source) => { if ( !claims.has(id) ) claims.set(id, builtin(id) ? ["builtin"] : []); claims.get(id).push(source); };
  for ( const { source, table } of plan ) for ( const id of Object.keys(table) ) claim(id, source);
  for ( const id of creations ) claim(id, creationsSource);
  return Array.from(claims, ([identifier, sources]) => ({ identifier, sources })).filter(c => c.sources.length > 1)
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  Résumé d'import                                                                                                           */
/* -------------------------------------------------------------------------------------------------------------------------- */

/**
 * Ce que le MJ voit avant d'accepter un import. `canImport` : aucune erreur (rien d'invalide n'entre, SPEC §9). Un module requis
 * absent ou une autre version du schéma n'empêchent pas l'import : le pack est rangé, inactif, et le MJ le sait.
 */
export function summarizeImport(raw, { engine, store, env, creations=[], builtin=() => false }) {
  const { pack, errors, ruleErrors, warnings } = readPack(raw, engine);
  if ( !pack ) return { pack: null, errors, ruleErrors, warnings, canImport: false };
  const identifiers = Object.keys(pack.rules).sort();
  const { decision, previous } = importDecision(store, pack);
  const status = packStatus({ pack, enabled: true }, env);
  // Le plan tel qu'il serait après l'import (ce pack compris, même inactif, pour dire ses conflits).
  const others = registrationPlan(withoutPack(store, pack.id), env);
  const plan = [...others, { source: sourceOf(pack.id), id: pack.id, table: pack.rules }].sort((a, b) => a.id.localeCompare(b.id));
  const mine = sourceOf(pack.id);
  return {
    pack, errors, ruleErrors, warnings,
    canImport: !errors.length && !Object.keys(ruleErrors).length,
    identifiers,
    ruleCount: identifiers.length,
    sourceCount: Object.keys(pack.sources).length,
    itemCount: pack.items?.documents?.length ?? 0,
    modules: pack.requires.modules.map(id => ({ id, present: env.isModuleActive(id) })),
    engine: { range: pack.requires[ENGINE_ID] ?? "", version: env.engineVersion, ok: !pack.requires[ENGINE_ID] || satisfies(env.engineVersion, pack.requires[ENGINE_ID]) },
    contentVersion: { pack: pack.contentVersion, engine: env.contentVersion, ok: pack.contentVersion === env.contentVersion },
    decision, previous, status,
    conflicts: conflicts({ plan, creations, builtin }).filter(c => c.sources.includes(mine))
  };
}

/* -------------------------------------------------------------------------------------------------------------------------- */
/*  Export                                                                                                                    */
/* -------------------------------------------------------------------------------------------------------------------------- */

/**
 * Un pack tiré d'une table de règles (les créations de l'atelier, déjà compilées et validées) et de métadonnées.
 * @param {{id: string, title: string, version?: string, authors?: string[], license?: string, contentVersion: number,
 *   engineRange?: string, modules?: string[], sources?: object, rules: object, documents?: object[]}} meta
 */
export function buildPack({ id, title, version="1.0.0", authors=[], license="", contentVersion, engineRange="", modules=[], sources={}, rules, documents=[] }) {
  return {
    format: PACK_FORMAT, formatVersion: FORMAT_VERSION, id, title, version, authors, license, contentVersion,
    requires: { ...(engineRange ? { [ENGINE_ID]: engineRange } : {}), modules },
    sources, rules,
    ...(documents.length ? { items: { documents } } : {})
  };
}

/** Le texte du fichier : clés des règles triées, pour qu'un export se compare d'une version à l'autre. */
export function packToJson(pack) {
  const sorted = obj => Object.fromEntries(Object.keys(obj ?? {}).sort().map(k => [k, obj[k]]));
  return JSON.stringify({ ...pack, sources: sorted(pack.sources), rules: sorted(pack.rules) }, null, 2);
}

/** Le nom du fichier exporté : « <id>-<version>.das-pack.json ». */
export const packFileName = pack => `${pack.id}-${pack.version}.das-pack.json`;
