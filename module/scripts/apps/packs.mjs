/**
 * La fenêtre des packs d'automatisation (SPEC §8.5), MJ seulement. Trois vues :
 *
 *   list     les packs importés (état, activer / désactiver, exporter, retirer) ; « Importer un pack » et « Exporter mes créations »
 *   summary  le résumé d'un fichier choisi (ou glissé dans la fenêtre), avant de l'accepter
 *   export   le choix des créations et les métadonnées du pack à exporter
 *
 * Toute la logique est dans runtime/packs.mjs ; ici, seulement l'affichage et les clics.
 */
import { MODULE_ID, loc, escape } from "../shared.mjs";
import { readStore } from "../adapter/store.mjs";
import { previewPack, importPack, setPackEnabled, removePack, listPacks, exportImportedPack, exportCreations, download } from "../runtime/packs.mjs";
import { suggestIdentifier } from "../core/creations.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/** Un problème `{ code, data }` du cœur, traduit. */
export const describe = (family, { code, data={} }) => loc(`Paquet.${family}.${code}`, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));

/** Une source du moteur, dite pour le MJ : contenu du moteur, un pack, les créations. */
function sourceLabel(source) {
  if ( source === "builtin" ) return loc("Paquet.Source.Moteur");
  if ( source === "creations" ) return loc("Paquet.Source.Creations");
  return loc("Paquet.Source.Pack", { id: source.replace(/^pack:/, "") });
}

export class PacksManager extends ApplicationV2 {
  constructor(options={}) {
    super(options);
    this.view = "list";
    this.summary = null;
    this.input = null;
    this.exportDraft = null;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-packs`,
    classes: ["dhb-creator", "dhb-packs"],
    window: { icon: "fa-solid fa-box-open", resizable: true, title: "DHB.Paquet.Titre" },
    position: { width: 640, height: 680 },
    actions: {
      pick: PacksManager.#onPick,
      accept: PacksManager.#onAccept,
      back: PacksManager.#onBack,
      toggle: PacksManager.#onToggle,
      exportPack: PacksManager.#onExportPack,
      remove: PacksManager.#onRemove,
      exportForm: PacksManager.#onExportForm,
      exportCreations: PacksManager.#onExportCreations
    }
  };

  static open() {
    if ( !game.user.isGM ) return ui.notifications.warn(loc("Refus.MJSeul"));
    const open = foundry.applications.instances.get(`${MODULE_ID}-packs`);
    if ( open ) return open.bringToFront();
    return new PacksManager().render({ force: true });
  }

  /** Montre le résumé d'un fichier (texte JSON ou objet), sans rien importer. */
  async preview(input) {
    this.input = input;
    this.summary = previewPack(input);
    this.view = "summary";
    return this.render();
  }

  /* ------------------------------------------------------------------ */

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "dhb-body";
    const body = { list: () => this.#list(), summary: () => this.#summary(), export: () => this.#export() }[this.view]();
    root.innerHTML = `<div class="dhb-step">${body}</div>${this.#footer()}
      <input type="file" class="dhb-file" accept=".json,application/json" hidden>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onFirstRender() {
    this.element.addEventListener("change", event => this.#onChange(event));
    this.element.addEventListener("dragover", event => event.preventDefault());
    this.element.addEventListener("drop", event => this.#onDrop(event));
  }

  #list() {
    const packs = listPacks();
    const rows = packs.length ? packs.map(p => {
      const state = !p.enabled ? "off" : (p.active ? "on" : "blocked");
      const reasons = p.reasons.filter(r => r.code !== "Disabled").concat(p.warnings).map(r => `<li>${escape(describe("Etat", r))}</li>`).join("");
      return `<div class="dhb-recipe dhb-pack dhb-pack-${state}" data-pack="${escape(p.id)}">
        <header>
          <h4>${escape(p.title)} <span class="dhb-hint">${escape(p.id)} · ${escape(p.version)}</span></h4>
          <label class="dhb-toggle" title="${escape(loc("Paquet.Activer"))}">
            <input type="checkbox" data-action="toggle" ${p.enabled ? "checked" : ""}> ${escape(loc("Paquet.Actif"))}</label>
          <button type="button" class="dhb-icon" data-action="exportPack" title="${escape(loc("Paquet.Exporter"))}"><i class="fa-solid fa-file-export"></i></button>
          <button type="button" class="dhb-icon" data-action="remove" title="${escape(loc("Paquet.Retirer"))}"><i class="fa-solid fa-trash"></i></button>
        </header>
        <p class="dhb-hint">${escape(loc("Paquet.Ligne", { authors: p.authors.join(", ") || "—", rules: p.ruleCount, sources: p.sourceCount, items: p.itemCount }))}</p>
        <p class="dhb-pack-state">${escape(loc(`Paquet.Statut.${state}`))}</p>
        ${reasons ? `<ul class="dhb-reasons">${reasons}</ul>` : ""}
      </div>`;
    }).join("") : `<p>${escape(loc("Paquet.Aucun"))}</p>`;
    return `<h3>${escape(loc("Paquet.Importes"))}</h3>
      <p class="dhb-hint">${escape(loc("Paquet.Explication"))}</p>
      ${rows}
      <div class="dhb-drop"><i class="fa-solid fa-file-import"></i> ${escape(loc("Paquet.Deposer"))}</div>`;
  }

  #summary() {
    const s = this.summary;
    if ( !s?.pack ) {
      return `<h3>${escape(loc("Paquet.Resume"))}</h3><p class="dhb-error">${escape(loc("Paquet.Illisible"))}</p>
        <ul class="dhb-reasons">${(s?.errors ?? []).map(e => `<li>${escape(describe("Erreur", e))}</li>`).join("")}</ul>`;
    }
    const p = s.pack;
    const row = (label, value, ok=true) => `<tr class="${ok ? "" : "dhb-bad"}"><th>${escape(label)}</th><td>${value}</td></tr>`;
    const modules = s.modules.length ? s.modules.map(m => `${escape(m.id)} ${m.present ? "✔" : `✘ (${escape(loc("Paquet.Absent"))})`}`).join("<br>") : escape(loc("Paquet.AucunModule"));
    const decision = escape(loc(`Paquet.Decision.${s.decision}`, { previous: s.previous ?? "", version: p.version }));
    const ruleErrors = Object.entries(s.ruleErrors).map(([id, errs]) => `<li><code>${escape(id)}</code> : ${escape(errs.join(" ; "))}</li>`).join("");
    const errors = s.errors.map(e => `<li>${escape(describe("Erreur", e))}</li>`).join("");
    const warnings = s.warnings.map(e => `<li>${escape(describe("Erreur", e))}</li>`).join("");
    const conflicts = s.conflicts.map(c => `<li><code>${escape(c.identifier)}</code> : ${escape(c.sources.map(sourceLabel).join(" < "))}</li>`).join("");
    const status = s.status.active ? "" : `<p class="dhb-error">${escape(loc("Paquet.SeraInactif"))}</p>
      <ul class="dhb-reasons">${s.status.reasons.map(r => `<li>${escape(describe("Etat", r))}</li>`).join("")}</ul>`;
    return `<h3>${escape(loc("Paquet.Resume"))}</h3>
      <table class="dhb-summary">
        ${row(loc("Paquet.Champ.Titre"), escape(p.title))}
        ${row(loc("Paquet.Champ.Id"), `<code>${escape(p.id)}</code>`)}
        ${row(loc("Paquet.Champ.Version"), `${escape(p.version)} — ${decision}`)}
        ${row(loc("Paquet.Champ.Auteurs"), escape(p.authors.join(", ") || "—"))}
        ${row(loc("Paquet.Champ.Licence"), escape(p.license || "—"))}
        ${row(loc("Paquet.Champ.Regles"), escape(String(s.ruleCount)))}
        ${row(loc("Paquet.Champ.Sources"), escape(String(s.sourceCount)))}
        ${row(loc("Paquet.Champ.Items"), escape(String(s.itemCount)))}
        ${row(loc("Paquet.Champ.Moteur"), escape(`${s.engine.range || "—"} (${s.engine.version})`), s.engine.ok)}
        ${row(loc("Paquet.Champ.Schema"), escape(`${s.contentVersion.pack} / ${s.contentVersion.engine}`), s.contentVersion.ok)}
        ${row(loc("Paquet.Champ.Modules"), modules, s.modules.every(m => m.present))}
      </table>
      ${status}
      ${errors || ruleErrors ? `<p class="dhb-error">${escape(loc("Paquet.Refuse"))}</p><ul class="dhb-reasons">${errors}${ruleErrors}</ul>` : ""}
      ${warnings ? `<ul class="dhb-reasons dhb-hint">${warnings}</ul>` : ""}
      ${conflicts ? `<h4>${escape(loc("Paquet.Conflits"))}</h4><p class="dhb-hint">${escape(loc("Paquet.ConflitsAide"))}</p><ul class="dhb-reasons">${conflicts}</ul>` : ""}
      <details><summary>${escape(loc("Paquet.Identifiants", { n: s.ruleCount }))}</summary>
        <p class="dhb-ids">${s.identifiers.map(i => `<code>${escape(i)}</code>`).join(" ")}</p></details>
      ${s.itemCount ? `<p class="dhb-hint">${escape(loc("Paquet.ItemsAide"))}</p>` : ""}`;
  }

  #export() {
    const d = this.exportDraft;
    const creations = Object.entries(readStore().entries);
    const list = creations.length ? creations.map(([id, c]) => `<label class="dhb-nature">
      <input type="checkbox" data-export="pick" value="${escape(id)}" ${d.identifiers.includes(id) ? "checked" : ""}>
      ${escape(c.name)} <span class="dhb-hint">${escape(id)}</span></label>`).join("") : `<p>${escape(loc("Paquet.Export.Aucune"))}</p>`;
    const field = (key, label, value, hint="") => `<label class="dhb-field"><span class="dhb-label">${escape(label)}</span>
      <input type="text" data-export="${key}" value="${escape(value)}">${hint ? `<span class="dhb-hint">${escape(hint)}</span>` : ""}</label>`;
    return `<h3>${escape(loc("Paquet.Export.Titre"))}</h3>
      <p class="dhb-hint">${escape(loc("Paquet.Export.Explication"))}</p>
      <div class="dhb-natures">${list}</div>
      ${field("title", loc("Paquet.Champ.Titre"), d.title)}
      ${field("id", loc("Paquet.Champ.Id"), d.id, loc("Paquet.Export.IdAide"))}
      ${field("version", loc("Paquet.Champ.Version"), d.version)}
      ${field("authors", loc("Paquet.Champ.Auteurs"), d.authors, loc("Paquet.Export.AuteursAide"))}
      ${field("license", loc("Paquet.Champ.Licence"), d.license)}
      <label class="dhb-field dhb-kind-boolean"><span class="dhb-label">${escape(loc("Paquet.Export.Items"))}</span>
        <input type="checkbox" data-export="includeItems" ${d.includeItems ? "checked" : ""}></label>
      <p class="dhb-hint">${escape(loc("Paquet.Export.ItemsAide"))}</p>
      <p class="dhb-hint">${escape(loc("Paquet.Export.Module"))}</p>`;
  }

  #footer() {
    const btn = (action, icon, key, disabled=false) => `<button type="button" data-action="${action}" ${disabled ? "disabled" : ""}><i class="${icon}"></i> ${escape(loc(key))}</button>`;
    if ( this.view === "summary" ) return `<footer class="dhb-footer">${btn("back", "fa-solid fa-arrow-left", "Bouton.Precedent")}
      ${btn("accept", "fa-solid fa-check", this.summary?.decision === "new" ? "Paquet.Accepter" : "Paquet.MettreAJour", !this.summary?.canImport)}</footer>`;
    if ( this.view === "export" ) return `<footer class="dhb-footer">${btn("back", "fa-solid fa-arrow-left", "Bouton.Precedent")}
      ${btn("exportCreations", "fa-solid fa-file-export", "Paquet.Export.Bouton", !this.exportDraft.identifiers.length)}</footer>`;
    return `<footer class="dhb-footer">${btn("exportForm", "fa-solid fa-file-export", "Paquet.Export.Ouvrir")}
      ${btn("pick", "fa-solid fa-file-import", "Paquet.Importer")}</footer>`;
  }

  /* ------------------------------------------------------------------ */

  async #onChange(event) {
    const el = event.target;
    if ( el.classList.contains("dhb-file") ) {
      const file = el.files?.[0];
      if ( file ) await this.preview(await foundry.utils.readTextFromFile(file));
      return;
    }
    const key = el.dataset.export;
    if ( !key || !this.exportDraft ) return;
    const d = this.exportDraft;
    if ( key === "pick" ) {
      d.identifiers = d.identifiers.filter(i => i !== el.value).concat(el.checked ? [el.value] : []);
      this.render();
    }
    else if ( key === "includeItems" ) d.includeItems = el.checked;
    else {
      d[key] = el.value;
      if ( (key === "title") && !d.idTouched ) {
        d.id = suggestIdentifier(el.value);
        const idField = this.element.querySelector('[data-export="id"]');
        if ( idField ) idField.value = d.id;
      }
      if ( key === "id" ) d.idTouched = true;
    }
  }

  async #onDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if ( file ) await this.preview(await foundry.utils.readTextFromFile(file));
  }

  static #onPick() {
    this.element.querySelector(".dhb-file")?.click();
  }

  static async #onAccept() {
    if ( !this.summary?.canImport ) return;
    const { imported, summary } = await importPack(this.input);
    if ( !imported ) return this.preview(this.input);
    ui.notifications.info(loc("Paquet.Importe", { title: summary.pack.title, version: summary.pack.version }));
    if ( !summary.status.active ) ui.notifications.warn(loc("Paquet.ImporteInactif", { title: summary.pack.title }));
    this.view = "list";
    this.summary = this.input = null;
    return this.render();
  }

  static #onBack() {
    this.view = "list";
    this.summary = this.input = null;
    this.render();
  }

  static async #onToggle(event, target) {
    const id = target.closest("[data-pack]")?.dataset.pack;
    if ( id ) await setPackEnabled(id, target.checked);
    this.render();
  }

  static async #onExportPack(event, target) {
    const id = target.closest("[data-pack]")?.dataset.pack;
    const file = id ? await exportImportedPack(id) : null;
    if ( file ) download(file);
  }

  static async #onRemove(event, target) {
    const id = target.closest("[data-pack]")?.dataset.pack;
    const rec = listPacks().find(p => p.id === id);
    if ( !rec ) return;
    const items = rec.itemCount ? `<label><input type="checkbox" name="deleteItems"> ${escape(loc("Paquet.RetirerItems", { n: rec.itemCount }))}</label>` : "";
    const answer = await DialogV2.confirm({
      window: { title: loc("Paquet.Retirer") },
      content: `<p>${escape(loc("Paquet.RetirerConfirmer", { title: rec.title }))}</p>${items}`,
      yes: { callback: (ev, button) => ({ deleteItems: !!button.form?.elements.deleteItems?.checked }) }
    });
    if ( !answer ) return;
    await removePack(id, answer);
    this.render();
  }

  static #onExportForm() {
    this.exportDraft = { identifiers: Object.keys(readStore().entries), title: "", id: "", idTouched: false, version: "1.0.0",
      authors: game.user.name, license: "MIT", includeItems: true };
    this.view = "export";
    this.render();
  }

  static async #onExportCreations() {
    const d = this.exportDraft;
    const title = d.title.trim() || loc("Paquet.Export.TitreParDefaut");
    const result = await exportCreations({ identifiers: d.identifiers, title, id: d.id.trim() || suggestIdentifier(title), version: d.version.trim() || "1.0.0",
      authors: d.authors.split(",").map(a => a.trim()).filter(Boolean), license: d.license.trim(), includeItems: d.includeItems });
    const skipped = Object.keys(result.skipped);
    if ( skipped.length ) ui.notifications.warn(loc("Paquet.Export.Ecartees", { ids: skipped.join(", ") }));
    if ( !Object.keys(result.pack.rules).length ) return ui.notifications.error(loc("Paquet.Export.Vide"));
    download(result);
  }
}

/** À `ready`, pour le MJ actif : les packs activés qui n'agissent pas (ou en partie), et pourquoi. */
export function warnPackProblems(problems) {
  if ( !game.user.isActiveGM ) return;
  for ( const p of problems ) {
    const why = [...p.reasons, ...p.warnings].map(r => describe("Etat", r)).join(" ; ");
    ui.notifications.warn(loc(p.active ? "Paquet.Affaibli" : "Paquet.Inactif", { title: p.title, why }), { permanent: !p.active });
  }
}
