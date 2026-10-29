/**
 * Le seul passage vers le moteur (`dnd5e-combat`) : son API publique, rien d'autre. Le moteur ne connaît pas ce module.
 */
const ENGINE_ID = "dnd5e-combat";

/** L'API de contenu du moteur, ou null s'il n'est pas actif (il est requis : ne devrait pas arriver). */
export function content() {
  return game.modules.get(ENGINE_ID)?.api?.content ?? null;
}

/** Le catalogue des recettes du moteur (core/recipes.mjs de dnd5e-combat). */
export function recipes() {
  return content()?.recipes ?? null;
}

/** L'entrée tirée d'une liste de recettes : `{ entry, errors }`. */
export function build(list, ctx) {
  return recipes().build(list, ctx);
}

/** Les erreurs d'une entrée du schéma (vide = valide). */
export function validate(entry) {
  return content()?.validate(entry) ?? ["moteur absent"];
}

/** L'automatisation en vigueur sur un item (toutes couches), pour une reprise « à partir de… ». */
export function entryOf(item) {
  return content()?.of(item)?.entry ?? null;
}

/**
 * Une automatisation existe-t-elle déjà sous cet identifiant, venue d'ailleurs que de cet atelier (contenu livré par le moteur,
 * ou un autre module) ? `shipped` est le contenu en vigueur, tables enregistrées comprises — la nôtre aussi : on l'écarte.
 */
export function takenElsewhere(identifier, source) {
  const api = content();
  if ( !api?.shipped?.[identifier] ) return false;
  return Object.entries(api.registered?.() ?? {}).some(([s, ids]) => (s !== source) && ids.includes(identifier))
    || !(api.registered?.()[source] ?? []).includes(identifier);
}

/** Enregistre (ou remplace) une table auprès du moteur, sur ce client ; `options.sources` : moteur ≥ §277. */
export function register(source, table, options) {
  return content()?.register(source, table, options) ?? null;
}

/** Retire une table (et ses sources) du moteur, sur ce client. */
export function unregister(source) {
  return content()?.unregister?.(source) ?? false;
}

/** Les sources enregistrées auprès du moteur, par table. */
export function registered() {
  return content()?.registered?.() ?? {};
}

/** De quoi lire un pack : la validation d'une entrée, et celle d'une table de sources quand le moteur l'a (§277). */
export function validators() {
  const api = content();
  return { validate, ...(typeof api?.validateSources === "function" ? { validateSources: api.validateSources } : {}) };
}

/**
 * Ce qui décide si un pack agit dans ce monde : version du moteur et de son schéma, modules actifs, sources enregistrables.
 * @returns {{engineVersion: string, contentVersion: number, isModuleActive: (id: string) => boolean, sourcesSupported: boolean}}
 */
export function environment() {
  const api = content();
  return {
    engineVersion: game.modules.get(ENGINE_ID)?.version ?? "0.0.0",
    contentVersion: api?.version ?? 0,
    isModuleActive: id => !!game.modules.get(id)?.active,
    sourcesSupported: typeof api?.sources === "function"
  };
}

/**
 * Le moteur livre-t-il lui-même une règle pour cet identifiant (hors tables enregistrées) ? `api.content.builtin` (§277) ; un moteur
 * plus ancien : le contenu en vigueur que nulle table n'a apporté.
 */
export function builtinIds() {
  const api = content();
  if ( api?.builtin ) return id => !!api.builtin[id];
  const fromTables = new Set(Object.values(api?.registered?.() ?? {}).flat());
  return id => !!api?.shipped?.[id] && !fromTables.has(id);
}

/**
 * Le niveau d'automatisation du moteur applique-t-il le contenu (niveau Intégral, §117 du moteur) ? Au-dessous, les créations
 * sont enregistrées mais sans effet. Un moteur sans niveaux (avant 0.202.0) : oui.
 */
export function contentApplies() {
  const api = game.modules.get(ENGINE_ID)?.api;
  return typeof api?.levelAtLeast === "function" ? api.levelAtLeast("full") : true;
}

/** `api.settings.registerWindow` du moteur (≥ 0.241.0), ou null. */
export function settingsWindow() {
  const fn = game.modules.get(ENGINE_ID)?.api?.settings?.registerWindow;
  return typeof fn === "function" ? fn : null;
}
