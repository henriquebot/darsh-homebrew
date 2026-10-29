/**
 * Les tables de l'atelier, tenues à jour auprès du moteur sur chaque client (SPEC §7, §8.4, §8.5) :
 * - les packs importés, chacun sous sa source `pack:<id>`, avec ses sources (id de document → identifiant) ;
 * - les créations, sous la source de l'atelier, enregistrées **après** les packs (le moteur fusionne dans l'ordre : elles l'emportent).
 *
 * Au démarrage, par le hook `dnd5e-combat.registerContent` (appelé une fois à `setup`, s'y inscrire pendant `init`) ; ensuite à chaque
 * écriture d'un des deux réglages (`onChange`, sur tous les clients). Le moteur garde la place d'une source déjà enregistrée : pour
 * qu'un pack importé plus tard passe avant les créations, tout est retiré puis enregistré de nouveau, dans l'ordre.
 */
import { MODULE_ID, log } from "../shared.mjs";
import { compileTable } from "../core/creations.mjs";
import { registrationPlan, packStatus } from "../core/packs.mjs";
import { readStore, readPacks } from "../adapter/store.mjs";
import * as engine from "../adapter/engine.mjs";

/** Les sources de packs enregistrées par ce client (pour les retirer au tour suivant). */
const packSources = new Set();

/** La table de toutes les créations ; une création fausse est écartée et dite dans la console. */
export function currentTable() {
  if ( !engine.recipes() ) return {};
  const { table, errors } = compileTable(readStore(), engine.build, engine.validate);
  if ( Object.keys(errors).length ) log.warn("creations rejected", errors);
  return table;
}

/** Le plan d'enregistrement des packs, vu ce monde. */
export function currentPlan() {
  return registrationPlan(readPacks(), engine.environment());
}

/**
 * Enregistre les packs actifs puis les créations. `register` : la fonction que passe le hook du moteur à `setup`, sinon son API.
 */
function registerAll(register=engine.register) {
  for ( const source of packSources ) engine.unregister(source);
  packSources.clear();
  engine.unregister(MODULE_ID);
  for ( const { source, table, sources } of currentPlan() ) {
    const result = register(source, table, Object.keys(sources).length ? { sources } : undefined);
    packSources.add(source);
    if ( result ) log.info(`${source}: ${result.accepted.length} rule(s)${result.sources?.length ? `, ${result.sources.length} source(s)` : ""}`);
  }
  return register(MODULE_ID, currentTable());
}

/** À appeler pendant `init`. */
export function registerRegistry() {
  Hooks.once("dnd5e-combat.registerContent", register => registerAll(register));
}

/** Après une écriture : tout est reconstruit et enregistré de nouveau. */
export function refresh() {
  const result = registerAll();
  if ( result ) log.info(`${result.accepted.length} automated creation(s)`);
}

/** Les packs rangés mais inactifs (ou affaiblis), pour prévenir le MJ : `[{ id, title, reasons, warnings }]`. */
export function packProblems() {
  const env = engine.environment();
  return Object.values(readPacks().packs).map(rec => ({ id: rec.pack.id, title: rec.pack.title, enabled: rec.enabled, ...packStatus(rec, env) }))
    .filter(p => p.enabled && (!p.active || p.warnings.length));
}
