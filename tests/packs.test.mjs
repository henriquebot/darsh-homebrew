import { describe, it, expect } from "vitest";
import {
  parseVersion, compareVersions, isRange, satisfies, parseJson, migratePack, readPack, normalizePacksStore, withPack, withoutPack,
  withEnabled, importDecision, packStatus, registrationPlan, conflicts, summarizeImport, buildPack, packToJson, packFileName, sourceOf
} from "../module/scripts/core/packs.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Le validateur du moteur (voir tests/creations.test.mjs). `validateSources` n'existe que depuis le §277 du moteur : à défaut, le
// contrôle local de l'atelier.
const CORE = process.env.DAS_CORE ?? resolve(import.meta.dirname, "../../Foundry dnd5e moteur de combat");
const { validateEntry, validateSources } = await import(pathToFileURL(resolve(CORE, "module/scripts/core/content.mjs")).href);
const facts = new Proxy({}, { has: () => true, get: () => true });
const engine = { validate: entry => validateEntry(entry, { facts }), ...(validateSources ? { validateSources } : {}) };

/** Un pack synthétique : des règles sur des identifiants inventés ou SRD, aucun contenu. */
const pack = (over={}) => ({
  format: "das-pack", formatVersion: 1, id: "pack-essai", title: "Pack d'essai", version: "1.0.0", authors: ["Essai"],
  license: "MIT", contentVersion: 1,
  requires: { "dnd5e-combat": ">=0.200.0", modules: [] },
  sources: { essaiDocument001: "poing-d-essai" },
  rules: {
    "poing-d-essai": { teleport: { distance: 30, units: "ft" } },
    "fire-bolt": { triggers: [{ on: "preDamageRoll", do: [{ type: "damage", formula: "1d4", damageType: "cold" }] }] }
  },
  ...over
});
const env = (over={}) => ({ engineVersion: "0.267.0", contentVersion: 1, isModuleActive: () => true, sourcesSupported: true, ...over });

describe("versions", () => {
  it("lecture, comparaison, contraintes", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.200")).toEqual([0, 200, 0]);
    expect(parseVersion("v1.0.0-beta")).toEqual([1, 0, 0]);
    expect(parseVersion("x")).toBe(null);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(satisfies("0.267.0", ">=0.200.0")).toBe(true);
    expect(satisfies("0.199.0", ">=0.200.0")).toBe(false);
    expect(satisfies("0.267.0", ">=0.200.0 <0.300.0")).toBe(true);
    expect(satisfies("1.0.0", ">=0.200.0 <1.0.0")).toBe(false);
    expect(satisfies("1.0.0", "1.0.0")).toBe(true);
    expect(satisfies("1.0.0", "")).toBe(true);
    expect(isRange(">=0.200.0")).toBe(true);
    expect(isRange("n'importe quoi")).toBe(false);
  });
});

describe("lecture d'un pack", () => {
  it("un pack valide est rangé sous sa forme propre", () => {
    const { pack: p, errors, ruleErrors } = readPack(pack(), engine);
    expect(errors).toEqual([]);
    expect(ruleErrors).toEqual({});
    expect(p.id).toBe("pack-essai");
    expect(Object.keys(p.rules)).toEqual(["poing-d-essai", "fire-bolt"]);
    expect(p.requires).toEqual({ "dnd5e-combat": ">=0.200.0", modules: [] });
  });

  it("JSON illisible, autre format, format plus récent", () => {
    expect(parseJson("{ pas du json").errors[0].code).toBe("NotJson");
    expect(readPack([], engine).errors[0].code).toBe("NotObject");
    expect(readPack(pack({ format: "autre" }), engine).errors[0].code).toBe("Format");
    expect(readPack(pack({ formatVersion: 2 }), engine).errors[0].code).toBe("FormatNewer");
    expect(readPack(pack({ formatVersion: "1" }), engine).errors[0].code).toBe("FormatVersion");
  });

  it("champs faux : chacun dit son problème", () => {
    const { errors } = readPack(pack({ id: "Pas Bon", title: "", version: "un", authors: [3], contentVersion: 0,
      requires: { "dnd5e-combat": "bientôt", modules: "dnd-players-handbook" }, sources: { court: "x" }, rules: {} }), engine);
    expect(errors.map(e => e.code)).toEqual(["Id", "Title", "Version", "Authors", "ContentVersion", "EngineRange", "Modules", "Sources", "RulesEmpty"]);
  });

  it("une règle fausse est dite par le moteur, sous son identifiant", () => {
    const { ruleErrors } = readPack(pack({ rules: { "ok-essai": { teleport: { distance: 30, units: "ft" } }, "faux-essai": { cleInconnue: true }, "Mauvais Id": {} } }), engine);
    expect(Object.keys(ruleErrors).sort()).toEqual(["Mauvais Id", "faux-essai"]);
    expect(ruleErrors["faux-essai"].join()).toMatch(/cleInconnue/);
  });

  it("une clé inconnue est un avertissement, pas une erreur ; les auteurs peuvent être une chaîne", () => {
    const { errors, warnings, pack: p } = readPack(pack({ extra: 1, authors: "Seul" }), engine);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([{ code: "UnknownKey", data: { key: "extra" } }]);
    expect(p.authors).toEqual(["Seul"]);
  });
});

describe("migration du format", () => {
  it("une version ancienne passe par les migrations, une sans migration est refusée", () => {
    const old = { ...pack(), formatVersion: 1, regles: pack().rules };
    delete old.rules;
    const migrations = { 1: p => { const { regles, ...rest } = p; return { ...rest, rules: regles }; } };
    const { pack: migrated, errors } = migratePack(old, migrations, 2);
    expect(errors).toEqual([]);
    expect(migrated.formatVersion).toBe(2);
    expect(Object.keys(migrated.rules)).toEqual(["poing-d-essai", "fire-bolt"]);
    expect(migratePack(old, {}, 2).errors[0].code).toBe("FormatNoMigration");
    // L'original n'est pas touché.
    expect(old.regles).toBeDefined();
  });

  it("au format courant, rien ne change", () => {
    expect(migratePack(pack()).pack).toEqual(pack());
  });
});

describe("rangement des packs", () => {
  const p = readPack(pack(), engine).pack;

  it("un réglage vide ou étranger donne un rangement vide ; un enregistrement mal formé est écarté", () => {
    expect(normalizePacksStore(undefined)).toEqual({ v: 1, packs: {} });
    expect(normalizePacksStore({ v: 2, packs: {} })).toEqual({ v: 1, packs: {} });
    expect(normalizePacksStore({ v: 1, packs: { a: { pack: { id: "b" } }, c: "x" } }).packs).toEqual({});
  });

  it("ajouter, mettre à jour (l'interrupteur reste), désactiver, retirer, sans toucher à l'original", () => {
    const a = normalizePacksStore({});
    const b = withPack(a, p, { importedAt: 1 });
    expect(a.packs).toEqual({});
    expect(b.packs["pack-essai"].enabled).toBe(true);
    const c = withEnabled(b, "pack-essai", false);
    expect(b.packs["pack-essai"].enabled).toBe(true);
    const d = withPack(c, { ...p, version: "1.1.0" }, { importedAt: 2 });
    expect(d.packs["pack-essai"]).toMatchObject({ enabled: false, importedAt: 2 });
    expect(d.packs["pack-essai"].pack.version).toBe("1.1.0");
    expect(withoutPack(d, "pack-essai").packs).toEqual({});
  });

  it("décision d'import : nouveau, mise à jour, identique, retour en arrière", () => {
    const s = withPack({}, p);
    expect(importDecision({}, p).decision).toBe("new");
    expect(importDecision(s, { ...p, version: "1.0.1" })).toEqual({ decision: "update", previous: "1.0.0" });
    expect(importDecision(s, p).decision).toBe("same");
    expect(importDecision(s, { ...p, version: "0.9.0" }).decision).toBe("downgrade");
  });
});

describe("état et enregistrement", () => {
  const p = readPack(pack(), engine).pack;

  it("actif, désactivé, module requis absent, autre version du schéma, moteur trop ancien", () => {
    expect(packStatus({ pack: p, enabled: true }, env())).toEqual({ active: true, reasons: [], warnings: [] });
    expect(packStatus({ pack: p, enabled: false }, env()).reasons.map(r => r.code)).toEqual(["Disabled"]);
    const premium = { ...p, requires: { modules: ["module-absent", "module-present"] } };
    expect(packStatus({ pack: premium, enabled: true }, env({ isModuleActive: id => id === "module-present" })).reasons)
      .toEqual([{ code: "MissingModules", data: { modules: "module-absent" } }]);
    expect(packStatus({ pack: { ...p, contentVersion: 2 }, enabled: true }, env()).reasons[0].code).toBe("ContentVersion");
    expect(packStatus({ pack: p, enabled: true }, env({ engineVersion: "0.150.0" })).reasons[0].code).toBe("EngineVersion");
    expect(packStatus({ pack: p, enabled: true }, env({ sourcesSupported: false }))).toMatchObject({ active: true, warnings: [{ code: "SourcesUnsupported" }] });
  });

  it("le plan : packs actifs seulement, par ordre alphabétique, sous la source « pack:<id> »", () => {
    let s = withPack({}, { ...p, id: "zeta-essai" });
    s = withPack(s, { ...p, id: "alpha-essai" });
    s = withPack(s, { ...p, id: "inactif-essai", contentVersion: 9 });
    const plan = registrationPlan(s, env());
    expect(plan.map(x => x.source)).toEqual(["pack:alpha-essai", "pack:zeta-essai"]);
    expect(plan[0].sources).toEqual({ essaiDocument001: "poing-d-essai" });
    expect(sourceOf("x")).toBe("pack:x");
  });
});

describe("conflits (SPEC §7)", () => {
  it("contenu du moteur < packs (ordre du plan) < créations ; un identifiant d'une seule source n'est pas un conflit", () => {
    const plan = [
      { source: "pack:a", table: { "fire-bolt": {}, "seul-a": {} } },
      { source: "pack:b", table: { "fire-bolt": {}, "partage": {} } }
    ];
    const out = conflicts({ plan, creations: ["partage", "creation-seule"], builtin: id => id === "fire-bolt" });
    expect(out).toEqual([
      { identifier: "fire-bolt", sources: ["builtin", "pack:a", "pack:b"] },
      { identifier: "partage", sources: ["pack:b", "creations"] }
    ]);
  });
});

describe("résumé d'import", () => {
  it("dit tout ce que le MJ doit savoir avant d'accepter", () => {
    const raw = pack({ requires: { "dnd5e-combat": ">=0.300.0", modules: ["module-absent"] } });
    const sum = summarizeImport(raw, { engine, store: {}, env: env({ isModuleActive: () => false }), creations: ["poing-d-essai"], builtin: id => id === "fire-bolt" });
    expect(sum.canImport).toBe(true);
    expect(sum).toMatchObject({ ruleCount: 2, sourceCount: 1, itemCount: 0, decision: "new", previous: null,
      modules: [{ id: "module-absent", present: false }], engine: { range: ">=0.300.0", ok: false }, contentVersion: { ok: true } });
    expect(sum.identifiers).toEqual(["fire-bolt", "poing-d-essai"]);
    expect(sum.status.active).toBe(false);
    expect(sum.conflicts).toEqual([
      { identifier: "fire-bolt", sources: ["builtin", "pack:pack-essai"] },
      { identifier: "poing-d-essai", sources: ["pack:pack-essai", "creations"] }
    ]);
  });

  it("une règle fausse empêche l'import", () => {
    const sum = summarizeImport(pack({ rules: { "faux-essai": { cleInconnue: true } } }), { engine, store: {}, env: env() });
    expect(sum.canImport).toBe(false);
    expect(Object.keys(sum.ruleErrors)).toEqual(["faux-essai"]);
  });

  it("une mise à jour se voit, et ne se dit pas en conflit avec sa propre version précédente", () => {
    const store = withPack({}, readPack(pack(), engine).pack);
    const sum = summarizeImport(pack({ version: "1.1.0" }), { engine, store, env: env() });
    expect(sum).toMatchObject({ decision: "update", previous: "1.0.0", conflicts: [] });
  });
});

describe("export", () => {
  it("un pack bâti depuis des règles se relit tel quel ; le fichier trie les règles", () => {
    const built = buildPack({ id: "mes-creations", title: "Mes créations", authors: ["MJ"], license: "MIT", contentVersion: 1,
      engineRange: ">=0.267.0", rules: { "zz-essai": { teleport: { distance: 10, units: "ft" } }, "aa-essai": { teleport: { distance: 5, units: "ft" } } },
      documents: [{ name: "Essai", type: "spell", system: { identifier: "aa-essai" } }] });
    const text = packToJson(built);
    const { pack: back, errors, ruleErrors } = readPack(JSON.parse(text), engine);
    expect(errors).toEqual([]);
    expect(ruleErrors).toEqual({});
    expect(Object.keys(JSON.parse(text).rules)).toEqual(["aa-essai", "zz-essai"]);
    expect(back.items.documents).toHaveLength(1);
    expect(back.requires).toEqual({ "dnd5e-combat": ">=0.267.0", modules: [] });
    expect(packFileName(back)).toBe("mes-creations-1.0.0.das-pack.json");
  });
});
