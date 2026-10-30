/**
 * DAS · Homebrew (darsh-homebrew) — point d'entrée. Voir SPEC.md.
 *
 * Requiert le moteur `dnd5e-combat` et ne passe que par son API publique (adapter/engine.mjs) ; le moteur ne connaît pas ce
 * module et tourne sans lui.
 */
import { MODULE_ID, loc } from "./shared.mjs";
import { registerSettings, readStore } from "./adapter/store.mjs";
import { install, homebrewPack } from "./adapter/compendium.mjs";
import { registerRegistry, refresh, currentTable, packProblems } from "./runtime/registry.mjs";
import { Creator } from "./apps/creator.mjs";
import { PacksManager, warnPackProblems } from "./apps/packs.mjs";
import * as packs from "./runtime/packs.mjs";
import * as engine from "./adapter/engine.mjs";
import * as workshop from "./runtime/workshop.mjs";

/** L'identifiant d'une création que cet item porte (copie posée sur une fiche comprise), ou null. */
function creationIdOf(item) {
  const id = engine.content()?.identifierOf?.(item)?.id ?? item?.system?.identifier;
  return (id && readStore().entries[id]) ? id : null;
}

Hooks.once("init", () => {
  registerSettings(() => refresh());
  registerRegistry();
});

// La fenêtre de réglages DAS (moteur ≥ 0.241.0, `api.settings.registerWindow`) : un onglet d'outils pour le MJ — les packs
// d'automatisation et le créateur. Avec un moteur plus ancien, le bouton du répertoire des items reste le seul accès.
Hooks.once("setup", () => {
  const register = engine.settingsWindow();
  if ( !register ) return;
  try {
    register({
      namespace: MODULE_ID, title: "DHB.Reglages.Titre",
      // Moteur ≥ §291 : l'atelier ferme la rangée des modules, à droite, ses outils en grandes cartes (ignoré par un moteur plus ancien).
      tab: { end: true, kind: "workshop", icon: "fa-solid fa-flask" },
      menu: { name: "DHB.Reglages.Menu.Nom", label: "DHB.Reglages.Menu.Bouton", hint: "DHB.Reglages.Menu.Aide", icon: "fa-solid fa-flask" },
      tabs: [{ id: "workshop", icon: "fa-solid fa-flask", label: "DHB.Reglages.Onglet", keys: [], tools: [
        { id: "packs", icon: "fa-solid fa-box-open", name: "DHB.Reglages.Paquets.Nom", hint: "DHB.Reglages.Paquets.Aide",
          button: "DHB.Reglages.Paquets.Bouton", open: () => PacksManager.open() },
        { id: "creator", icon: "fa-solid fa-flask", name: "DHB.Reglages.Createur.Nom", hint: "DHB.Reglages.Createur.Aide",
          button: "DHB.Reglages.Createur.Bouton", open: () => Creator.open() }
      ] }]
    });
  }
  catch(err) { console.error(err); }
});

Hooks.once("ready", () => {
  install();
  warnPackProblems(packProblems());
  game.modules.get(MODULE_ID).api = Object.freeze({
    /** Ouvre le créateur ; avec un identifiant, rouvre cette création. */
    open: identifier => Creator.open(identifier ?? null),
    /** Ouvre la fenêtre des packs d'automatisation. */
    packs: () => PacksManager.open(),
    /** Les créations de ce monde (rangement brut). */
    creations: () => readStore().entries,
    /** La table enregistrée auprès du moteur. */
    table: currentTable,
    pack: homebrewPack,
    /**
     * Pour les vérifications par le connecteur (`call-module-api`, verrou « Outils de test » du monde) : piloter l'atelier
     * sans fenêtre, et lire ce que le moteur en reçoit. Valeurs de retour sérialisables.
     */
    mcp: Object.freeze({
      etat: () => ({
        pack: homebrewPack()?.collection ?? null,
        creations: readStore().entries,
        enregistre: engine.content()?.registered?.()[MODULE_ID] ?? [],
        recettes: Object.keys(engine.recipes()?.list ?? {})
      }),
      creer: async args => (await workshop.createCreation(args)).uuid,
      automatiser: ({ identifier, recipes }) => workshop.saveAutomation(identifier, { recipes }),
      apercu: ({ identifier, recipes }) => workshop.preview(identifier, { recipes }),
      retirer: ({ identifier, deleteItem=false }) => workshop.removeCreation(identifier, { deleteItem }),
      /** Ce que le moteur applique à un item (uuid), couches comprises. */
      moteur: async ({ uuid }) => {
        const item = await fromUuid(uuid);
        const of = item ? engine.content()?.of(item) : null;
        return of ? { identifier: of.identifier, layers: of.layers, entry: of.entry } : null;
      },
      /** Ouvre le créateur et rend son texte (et ses boutons) après rendu. */
      ouvrir: async ({ identifier=null }={}) => {
        const app = await Creator.open(identifier);
        return { id: app?.id, texte: app?.element?.innerText ?? null };
      },
      /** Le texte de toutes les fenêtres du créateur ouvertes. */
      fenetres: () => Array.from(foundry.applications.instances.values()).filter(a => a instanceof Creator)
        .map(a => ({ id: a.id, step: a.draft?.step, texte: a.element?.innerText })),
      fermer: () => Promise.all(Array.from(foundry.applications.instances.values()).filter(a => (a instanceof Creator) || (a instanceof PacksManager)).map(a => a.close())),
      // --- Packs (SPEC §8.5) : `json` est le texte du fichier (ou l'objet). -----------------------------------------------------
      /** Le résumé que le MJ verrait avant d'accepter. */
      paquetApercu: ({ json }) => packs.previewPack(json),
      /** Importe (ou met à jour) un pack : refusé s'il a une erreur. */
      paquetImporter: async ({ json }) => {
        const r = await packs.importPack(json);
        return { imported: r.imported, items: r.items, summary: r.summary };
      },
      /** Les packs importés et leur état ; `registered` : ce que le moteur a reçu sous leur source. */
      paquets: () => packs.listPacks(),
      paquetActiver: ({ id, enabled=true }) => packs.setPackEnabled(id, enabled),
      paquetRetirer: ({ id, deleteItems=false }) => packs.removePack(id, { deleteItems }),
      /** Le fichier d'un pack importé : `{ name, text }`. */
      paquetExporter: ({ id }) => packs.exportImportedPack(id),
      /** Un pack tiré de créations : `{ name, text, skipped }`. */
      exporterCreations: async args => {
        const { name, text, skipped } = await packs.exportCreations(args ?? {});
        return { name, text, skipped };
      },
      /** Les sources que le moteur a reçues, et l'identifiant sous lequel il reconnaît un item (uuid). */
      sources: async ({ uuid }={}) => ({
        registered: engine.content()?.sources?.() ?? null,
        identifier: uuid ? engine.content()?.identifierOf?.(await fromUuid(uuid)) ?? null : null
      }),
      /** Ouvre la fenêtre des packs (avec un fichier : son résumé) et rend son texte. */
      paquetFenetre: async ({ json=null }={}) => {
        const app = await PacksManager.open();
        const win = foundry.applications.instances.get(`${MODULE_ID}-packs`) ?? app;
        if ( json ) await win.preview(json);
        return { texte: win?.element?.innerText ?? null };
      }
    })
  });
});

// En-tête de la fiche d'un item de l'atelier (dans le compendium ou posé sur une fiche) : rouvrir son automatisation.
// Hook du cœur V14 `getHeaderControls<Classe>` (client/applications/api/application.mjs:762), fiche d'item de dnd5e 6 :
// `ItemSheet5e` (module/applications/item/item-sheet.mjs:21).
Hooks.on("getHeaderControlsItemSheet5e", (app, controls) => {
  if ( !game.user.isGM ) return;
  const identifier = creationIdOf(app.document);
  if ( !identifier ) return;
  controls.push({ icon: "fa-solid fa-flask", label: loc("Fiche.Automatisation"), action: "dhbAutomation",
    onClick: () => Creator.open(identifier) });
});

// Bouton « Créer » dans le répertoire des items (`.header-actions`, templates/sidebar/directory/header.hbs:4).
Hooks.on("renderItemDirectory", (app, html) => {
  if ( !game.user.isGM ) return;
  const actions = html.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".dhb-open") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dhb-open";
  button.innerHTML = `<i class="fa-solid fa-flask"></i> ${loc("Repertoire.Creer")}`;
  button.addEventListener("click", () => Creator.open());
  const packsButton = document.createElement("button");
  packsButton.type = "button";
  packsButton.className = "dhb-packs-open";
  packsButton.innerHTML = `<i class="fa-solid fa-box-open"></i> ${loc("Repertoire.Paquets")}`;
  packsButton.addEventListener("click", () => PacksManager.open());
  actions.append(button, packsButton);
});
