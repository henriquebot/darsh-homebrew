import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ISSUE_CODES, STATUS_CODES } from "../module/scripts/core/packs.mjs";

const ROOT = join(import.meta.dirname, "../module");
const scripts = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? scripts(join(dir, e.name)) : (e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));

/** Les clés `DHB.*` que le code demande : littérales, et les familles construites (`Etape.${…}`, `Nature.${…}`) dépliées. */
function usedKeys() {
  const keys = new Set();
  for ( const file of scripts(join(ROOT, "scripts")) ) {
    const src = readFileSync(file, "utf8");
    for ( const [, k] of src.matchAll(/\bloc\("([A-Za-z.]+)"/g) ) keys.add(`DHB.${k}`);
    for ( const [, k] of src.matchAll(/loc\(\s*([A-Za-z]+\s*\?\s*)?"([A-Z][A-Za-z.]+)"\s*:\s*"([A-Z][A-Za-z.]+)"/g) ) { keys.add(`DHB.${k}`); }
    // Clés complètes écrites telles quelles (titre de fenêtre, fenêtre de réglages du moteur), et celles passées aux boutons des packs.
    for ( const [, k] of src.matchAll(/"DHB\.([A-Za-z.]+)"/g) ) keys.add(`DHB.${k}`);
    for ( const [, k] of src.matchAll(/"(Paquet\.[A-Za-z.]+)"/g) ) keys.add(`DHB.${k}`);
  }
  for ( const step of ["start", "nature", "identity", "native", "automation"] ) keys.add(`DHB.Etape.${step}`);
  for ( const n of ["spell", "classFeature", "speciesTrait", "feat", "monsterFeature", "weapon", "equipment", "consumable"] ) keys.add(`DHB.Nature.${n}`);
  for ( const k of ["Automatisation.Valide", "Automatisation.Vide"] ) keys.add(`DHB.${k}`);
  // Les packs : problèmes du cœur (core/packs.mjs), états, décisions d'import.
  for ( const c of ISSUE_CODES ) keys.add(`DHB.Paquet.Erreur.${c}`);
  for ( const c of STATUS_CODES ) keys.add(`DHB.Paquet.Etat.${c}`);
  for ( const c of ["on", "off", "blocked"] ) keys.add(`DHB.Paquet.Statut.${c}`);
  for ( const c of ["new", "update", "same", "downgrade"] ) keys.add(`DHB.Paquet.Decision.${c}`);
  return keys;
}

describe("fichiers de langue", () => {
  for ( const lang of ["fr", "en"] ) {
    it(`${lang} : chaque clé demandée existe`, () => {
      const json = JSON.parse(readFileSync(join(ROOT, `lang/${lang}.json`), "utf8"));
      expect(Array.from(usedKeys()).filter(k => !(k in json))).toEqual([]);
    });
  }

  it("fr et en ont les mêmes clés", () => {
    const fr = Object.keys(JSON.parse(readFileSync(join(ROOT, "lang/fr.json"), "utf8"))).sort();
    const en = Object.keys(JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"))).sort();
    expect(fr).toEqual(en);
  });
});
