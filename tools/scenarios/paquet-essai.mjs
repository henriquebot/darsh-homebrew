/**
 * Un pack d'automatisation importé, de bout en bout (SPEC §8.5) — pack **synthétique**, construit ici : aucune donnée tierce.
 *
 *  - L'Ensorceleur reçoit « Coup d'essai (pack) », une copie de son Trait de feu dont l'identifiant vient du nom (`coup-d-essai-pack`),
 *    comme un item importé par un outil tiers ; le pack le reconnaît par son id de document (`sources`) sous `poing-essai-das`, et
 *    lui donne +1d6 froid sur ses dégâts.
 *  - Résumé avant import (règles, sources, modules requis, conflits), import, règle vue par le moteur, jouée en combat ;
 *    désactivation (plus rien), réactivation, mise à jour 1.1.0 (2d6, interrupteur gardé), export, retrait (sources comprises).
 *  - Un second pack qui requiert un module absent : importé, inactif, rien d'enregistré.
 *  - L'export de créations de l'atelier (sans items) et son résumé : le conflit avec la création elle-même est dit.
 *
 * Se lance avec le lanceur du moteur : `node tools/scenario.mjs "../Foundry dnd5e homebrew/tools/scenarios"` (depuis le dépôt du moteur).
 */
const PACK = "essai-das-pack";
const ABSENT = "essai-das-pack-absent";
const RULE = "poing-essai-das";
const NAME = "Coup d'essai (pack)";
const OWN_ID = "coup-d-essai-pack";

const rule = formula => ({ triggers: [{ on: "preDamageRoll", if: { "activity.identifier": RULE }, do: [{ type: "damage", formula, damageType: "cold" }] }] });
const pack = ({ version, formula, sources }) => ({
  format: "das-pack", formatVersion: 1, id: PACK, title: "Pack d'essai DAS", version, authors: ["Scénario"], license: "MIT",
  contentVersion: 1, requires: { "dnd5e-combat": ">=0.200.0", modules: [] }, sources, rules: { [RULE]: rule(formula) }
});

export default {
  name: "homebrew — pack importé (sources, résumé, actif en combat, désactivé, mis à jour, exporté, retiré)",

  async run(ctx) {
    const hb = async (fn, args={}) => {
      const r = await ctx.call("call-module-api", { moduleId: "darsh-homebrew", fn, args, waitMs: 8000 });
      if ( !r.settled ) throw new Error(`darsh-homebrew.${fn} : pas de réponse`);
      return r.result;
    };
    const registered = async () => (await hb("paquets")).find(p => p.id === PACK)?.registered ?? [];

    await hb("paquetRetirer", { id: PACK });
    await hb("paquetRetirer", { id: ABSENT });
    ctx.restore(() => hb("paquetRetirer", { id: PACK }));
    ctx.restore(() => hb("paquetRetirer", { id: ABSENT }));

    // --- L'item sans identifiant utilisable --------------------------------------------------------------------------
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: sorc.id });
    const actor = await ctx.call("get-actor", { actorId: tok.actorId });
    const bolt = (actor.items ?? []).find(i => i.system?.identifier === "fire-bolt");
    if ( !bolt ) { ctx.expect(false, "l'Ensorceleur n'a pas Trait de feu"); return; }
    const { _id, folder, ownership, _stats, ...boltData } = bolt;
    const itemData = { ...boltData, name: NAME, system: { ...boltData.system, identifier: OWN_ID } };
    await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: OWN_ID } });
    const itemId = await ctx.itemId(sorc.id, OWN_ID);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
    const uuid = `Actor.${tok.actorId}.Item.${itemId}`;
    const before = await hb("sources", { uuid });
    ctx.expect(before.identifier?.id === OWN_ID, `sans pack, l'item est reconnu sous « ${before.identifier?.id} » (tiré du nom)`);
    const sources = { [itemId]: RULE };

    // --- Résumé, puis import --------------------------------------------------------------------------------------------
    const v1 = pack({ version: "1.0.0", formula: "1d6", sources });
    const sum = await hb("paquetApercu", { json: JSON.stringify(v1) });
    ctx.expect(sum.canImport && sum.ruleCount === 1 && sum.sourceCount === 1 && sum.decision === "new",
      `résumé : importable, 1 règle, 1 source, nouveau (${JSON.stringify({ canImport: sum.canImport, errors: sum.errors, ruleErrors: sum.ruleErrors })})`);
    ctx.expect(sum.engine.ok && sum.contentVersion.ok && sum.status.active, `résumé : moteur ${sum.engine.version} et schéma ${sum.contentVersion.engine} conformes, sera actif`);
    const win = await hb("paquetFenetre", { json: JSON.stringify(v1) });
    ctx.expect(/Pack d.essai DAS/.test(win.texte ?? "") && win.texte.includes(PACK), "la fenêtre montre le résumé (titre, identifiant du pack)");
    await hb("fermer");

    const bad = await hb("paquetApercu", { json: JSON.stringify({ ...v1, rules: { [RULE]: { cleInconnue: true } } }) });
    ctx.expect(!bad.canImport && bad.ruleErrors[RULE]?.length, `une règle fausse est refusée par le moteur (${bad.ruleErrors[RULE]?.join(" ; ")})`);

    const imp = await hb("paquetImporter", { json: JSON.stringify(v1) });
    ctx.expect(imp.imported, "pack importé");
    await new Promise(r => setTimeout(r, 500));
    ctx.expect((await registered()).includes(RULE), `le moteur a reçu la règle sous « pack:${PACK} »`);
    const after = await hb("sources", { uuid });
    ctx.expect(after.identifier?.id === RULE && after.identifier?.from === "source", `avec le pack, l'item est reconnu sous « ${after.identifier?.id} » (${after.identifier?.from})`);
    ctx.expect(after.registered?.[`pack:${PACK}`]?.[itemId] === RULE, "la source est enregistrée auprès du moteur");
    const seen = await hb("moteur", { uuid });
    ctx.expect(seen?.entry?.triggers?.[0]?.do?.[0]?.formula === "1d6", `le moteur applique la règle du pack (${JSON.stringify(seen?.entry)})`);

    // --- En combat ------------------------------------------------------------------------------------------------------
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    let hit = null;
    for ( let shot = 1; shot <= 6 && !hit; shot++ ) {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: sorc.id, identifier: OWN_ID, activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      if ( r.targets[0]?.hit ) hit = { r, used };
    }
    if ( !hit ) ctx.expect(false, "aucun tir n'a touché en six essais");
    else {
      const damage = (await ctx.messagesSince(hit.used.usageMessageId)).find(m => m.type === "damage");
      const formula = (damage?.rolls ?? []).map(x => x.formula).join(" | ");
      const types = (hit.r.damageRoll?.damages ?? []).map(d => d.type);
      ctx.expect(types.includes("cold") || /cold/.test(formula), `en combat : +1d6 froid ajouté par le pack (${JSON.stringify(types)}, « ${formula} »)`);
    }

    // --- Désactiver, réactiver ------------------------------------------------------------------------------------------
    await hb("paquetActiver", { id: PACK, enabled: false });
    await new Promise(r => setTimeout(r, 500));
    const off = (await hb("paquets")).find(p => p.id === PACK);
    ctx.expect(off && !off.enabled && !off.active && !off.registered.length, "désactivé : rangé, inactif, rien d'enregistré");
    ctx.expect((await hb("sources", { uuid })).identifier?.id === OWN_ID, "désactivé : la source n'agit plus");
    ctx.expect(!(await hb("moteur", { uuid }))?.entry?.triggers, "désactivé : le moteur n'applique plus la règle");
    await hb("paquetActiver", { id: PACK, enabled: true });
    await new Promise(r => setTimeout(r, 500));
    ctx.expect((await registered()).includes(RULE), "réactivé : la règle revient");

    // --- Mise à jour ----------------------------------------------------------------------------------------------------
    const v2 = pack({ version: "1.1.0", formula: "2d6", sources });
    const up = await hb("paquetApercu", { json: JSON.stringify(v2) });
    ctx.expect(up.decision === "update" && up.previous === "1.0.0", `résumé de la mise à jour : ${up.decision} depuis ${up.previous}`);
    await hb("paquetActiver", { id: PACK, enabled: false });
    await hb("paquetImporter", { json: JSON.stringify(v2) });
    await new Promise(r => setTimeout(r, 500));
    let rec = (await hb("paquets")).find(p => p.id === PACK);
    ctx.expect(rec?.version === "1.1.0" && !rec.enabled, "mise à jour : version 1.1.0, l'interrupteur du MJ est gardé (désactivé)");
    await hb("paquetActiver", { id: PACK, enabled: true });
    await new Promise(r => setTimeout(r, 500));
    const seen2 = await hb("moteur", { uuid });
    ctx.expect(seen2?.entry?.triggers?.[0]?.do?.[0]?.formula === "2d6", "mise à jour : le moteur applique 2d6");

    // --- Export ---------------------------------------------------------------------------------------------------------
    const file = await hb("paquetExporter", { id: PACK });
    const back = JSON.parse(file?.text ?? "{}");
    ctx.expect(file?.name === `${PACK}-1.1.0.das-pack.json` && back.version === "1.1.0" && back.rules?.[RULE] && back.sources?.[itemId] === RULE,
      `export : ${file?.name}, règles et sources intactes`);
    const again = await hb("paquetApercu", { json: file.text });
    ctx.expect(again.canImport && again.decision === "same", "le fichier exporté se relit (même version)");

    // --- Un module requis absent ----------------------------------------------------------------------------------------
    const absent = { ...v1, id: ABSENT, title: "Pack d'essai (module absent)", requires: { modules: ["module-inexistant-das"] }, sources: {} };
    const sumAbsent = await hb("paquetApercu", { json: JSON.stringify(absent) });
    ctx.expect(sumAbsent.canImport && !sumAbsent.status.active && sumAbsent.modules[0]?.present === false, "module absent : importable, mais sera inactif");
    await hb("paquetImporter", { json: JSON.stringify(absent) });
    await new Promise(r => setTimeout(r, 500));
    const recAbsent = (await hb("paquets")).find(p => p.id === ABSENT);
    ctx.expect(recAbsent && recAbsent.enabled && !recAbsent.active && !recAbsent.registered.length
      && recAbsent.reasons.some(x => x.code === "MissingModules"), `module absent : rangé, inactif (${recAbsent?.reasons.map(x => x.code).join(", ")}), rien d'enregistré`);
    // Les deux packs visent la même règle : le conflit est dit (l'inactif ne compte pas dans le plan).
    ctx.expect(!sumAbsent.conflicts.length || sumAbsent.conflicts.every(c => c.sources.includes(`pack:${ABSENT}`)), "conflits du résumé : seulement ceux de ce pack");

    // --- Export de créations ----------------------------------------------------------------------------------------------
    const creations = Object.keys((await hb("etat")).creations ?? {});
    if ( creations.length ) {
      const exp = await hb("exporterCreations", { identifiers: [creations[0]], title: "Export d'essai", includeItems: false });
      const out = JSON.parse(exp.text);
      ctx.expect(out.format === "das-pack" && out.id === "export-d-essai" && out.rules?.[creations[0]], `créations exportées : ${exp.name} (${Object.keys(out.rules ?? {}).join(", ")})`);
      const sumExp = await hb("paquetApercu", { json: exp.text });
      ctx.expect(sumExp.canImport && sumExp.conflicts.some(c => c.identifier === creations[0] && c.sources.at(-1) === "creations"),
        "le résumé de cet export dit le conflit avec la création (qui l'emporte)");

      // Avec ses items : créés à l'import dans le compendium Homebrew (dossier du pack), réexportés, supprimés avec le pack.
      const count = async () => (await ctx.call("list-compendium-entries", { packId: "world.darsh-homebrew" })).length;
      const withItems = await hb("exporterCreations", { identifiers: [creations[0]], title: "Export d'essai items", includeItems: true });
      const outItems = JSON.parse(withItems.text);
      ctx.expect(outItems.items?.documents?.length === 1, `export avec items : ${outItems.items?.documents?.length ?? 0} item`);
      const n0 = await count();
      ctx.restore(() => hb("paquetRetirer", { id: outItems.id, deleteItems: true }));
      const r = await hb("paquetImporter", { json: withItems.text });
      ctx.expect(r.imported && (r.items === 1) && (await count() === n0 + 1), `import avec items : ${r.items} item créé dans le compendium Homebrew`);
      const re = JSON.parse((await hb("paquetExporter", { id: outItems.id }))?.text ?? "{}");
      ctx.expect(re.items?.documents?.length === 1, "le pack importé se réexporte avec son item");
      await hb("paquetRetirer", { id: outItems.id, deleteItems: true });
      ctx.expect(await count() === n0, "retiré avec ses items : le compendium revient à son état");
    }
    else ctx.log("aucune création dans ce monde : export de créations non joué");

    // --- Retrait ----------------------------------------------------------------------------------------------------------
    await hb("paquetRetirer", { id: PACK });
    await hb("paquetRetirer", { id: ABSENT });
    await new Promise(r => setTimeout(r, 500));
    const gone = await hb("sources", { uuid });
    ctx.expect(!(await hb("paquets")).length || !(await hb("paquets")).some(p => [PACK, ABSENT].includes(p.id)), "retirés : plus aucun pack d'essai");
    ctx.expect(!gone.registered?.[`pack:${PACK}`] && gone.identifier?.id === OWN_ID, "retiré : la source est retirée du moteur");
  }
};
