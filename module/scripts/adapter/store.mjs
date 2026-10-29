/**
 * Les réglages de l'atelier : le rangement des créations (SPEC §8.4), celui des packs importés (§8.5, à part des créations) et le
 * compendium du monde où vivent leurs items.
 * Un réglage monde se relit sur tous les clients à chaque écriture (`onChange`) : c'est ce qui tient la table du moteur à
 * jour chez les joueurs, sans socket.
 */
import { MODULE_ID } from "../shared.mjs";
import { normalizeStore, withCreation } from "../core/creations.mjs";
import { normalizePacksStore } from "../core/packs.mjs";

export const STORE_SETTING = "creations";
export const PACKS_SETTING = "packs";
export const PACK_SETTING = "pack";
export const INSTALLED_SETTING = "installed";

/** @param {Function} onChange  appelée sur chaque client quand une création ou un pack change */
export function registerSettings(onChange) {
  game.settings.register(MODULE_ID, STORE_SETTING, { scope: "world", config: false, type: Object, default: {}, onChange });
  game.settings.register(MODULE_ID, PACKS_SETTING, { scope: "world", config: false, type: Object, default: {}, onChange });
  game.settings.register(MODULE_ID, PACK_SETTING, { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, INSTALLED_SETTING, { scope: "world", config: false, type: Boolean, default: false });
}

export function readStore() {
  return normalizeStore(game.settings.get(MODULE_ID, STORE_SETTING));
}

/** Une création de ce monde, ou null. */
export function creationOf(identifier) {
  return readStore().entries[identifier] ?? null;
}

/** Écrit (ou retire, avec `null`) une création. MJ seulement. */
export async function saveCreation(identifier, creation) {
  return game.settings.set(MODULE_ID, STORE_SETTING, withCreation(readStore(), identifier, creation));
}

/** Les packs importés dans ce monde. */
export function readPacks() {
  return normalizePacksStore(game.settings.get(MODULE_ID, PACKS_SETTING));
}

/** Écrit le rangement des packs. MJ seulement. */
export async function savePacks(store) {
  return game.settings.set(MODULE_ID, PACKS_SETTING, normalizePacksStore(store));
}
