# DAS · Homebrew (`darsh-homebrew`)

[![Tests](https://github.com/Darshyne/darsh-homebrew/actions/workflows/tests.yml/badge.svg)](https://github.com/Darshyne/darsh-homebrew/actions/workflows/tests.yml)

**[Website](https://darshyne.github.io)** · **[Discord](https://discord.gg/PDSq8dYdTP)** (questions, bugs, ideas)

> **Beta.** Darshyne's Automation Suite is still in beta: not every spell and feature is covered yet, and things may change
> between versions. If something doesn't behave as it should, tell us on [Discord](https://discord.gg/PDSq8dYdTP) or
> [open an issue](https://github.com/Darshyne/darsh-homebrew/issues).

Part of **Darshyne's Automation Suite (DAS)**. A step-by-step **creator of automated items** for **Foundry VTT V14** and
**dnd5e 6.x**, for GMs who don't write code: spells, class features, species traits, feats, weapons, equipment,
consumables and monster features.

- **Start from scratch, or from any existing item**: drop a spell or a feature into the creator and it keeps its
  activities, effects and current automation — you only change what differs ("like Thunderwave, but cold").
- **dnd5e does what dnd5e does**: activities (attack, save, damage, healing, summon…), range, area and effects are set
  on the item's own sheet.
- **The engine does the rest**: pick building blocks from a catalogue and fill in simple forms — bonus damage,
  advantage or disadvantage, a condition on a hit or a failed save, push or pull, repeated save, effect ending on
  damage, lasting zone, aura, reaction, retaliation, save on hit, teleport, summon, usage limits, effects ending on a
  rest. Conditions are built from plain choices ("the target has the Prone condition", "the target is within 10 ft").
  The engine checks every automation before it is saved and shows exactly what it will receive.
- Creations live in a compendium **created in your world** on first launch ("Homebrew (DAS)"), so they stay yours and
  editable. Their rules are recognised by identifier on every sheet the item is placed on, PCs and NPCs alike, and
  editing a creation updates all of them at once, for every connected player.

It **requires the [`dnd5e-combat`](https://github.com/Darshyne/dnd5e-combat) engine** (≥ 0.201.0), whose recipe
catalogue (`api.content.recipes`) defines the building blocks: what the engine cannot do, the creator cannot offer.
The engine does not depend on this module and runs without it.

## Use

GM only. In the Items sidebar, **Create (Homebrew)**. To edit a creation later, open its sheet (in the compendium or on
an actor) and use **Automation (Homebrew)** in the window header.

## Automation packs

An automation pack is a `.json` file that holds **rules only**, keyed by dnd5e item identifier: no text, no image, no
item sheet. It automates items your world already has — from the SRD, from a module you own, or imported by another
tool — without shipping any of their content. DAS · Homebrew ships **no pack**: it only provides the tool.

GM only. **Packs (Homebrew)** in the Items sidebar, or the **Workshop** tab of the DAS settings window:

- **Import a pack** (button, or drop the file into the window): the engine checks every rule first, and you see a summary
  before accepting — id, title, version, authors, number of rules, targeted identifiers, required modules present or
  missing, identifiers already automated elsewhere, errors. A pack with any invalid rule is refused.
- Each imported pack can be **enabled or disabled**, **updated** (import a newer version: your on/off choice is kept),
  **exported** again, or **removed**. A pack whose required module is missing, or written for another version of the
  engine's schema, stays inactive and the GM is told why.
- **Export my creations** turns some of your creations into a pack (optionally with their items), to import in another
  world. Do not share items created from another module's item: they keep its text and image.

Priority, last wins key by key: engine content < packs (alphabetical by id) < your creations < the GM's world overlay.

```jsonc
{
  "format": "das-pack", "formatVersion": 1,
  "id": "my-pack", "title": "My pack", "version": "1.0.0", "authors": ["Me"], "license": "MIT",
  "contentVersion": 1,                                   // the engine's content schema version (api.content.version)
  "requires": { "dnd5e-combat": ">=0.267.0", "modules": [] },  // modules whose items the pack automates
  "sources": { "<16-character document id>": "my-strike" },  // items without a usable identifier
  "rules": { "my-strike": { /* an entry of the engine's content schema */ } }
}
```

`rules` is exactly what the engine's `api.content.register(source, table)` accepts. `sources` maps the id of an item
(its compendium source, or the item itself) to the identifier its rule is filed under, for items whose identifier
dnd5e derived from their (possibly translated) name.

## Installation

In Foundry (or on The Forge), *Install Module* → paste the manifest URL:

```
https://github.com/Darshyne/darsh-homebrew/releases/latest/download/module.json
```

From source: the Foundry module is the `module/` subfolder, to copy or link into `Data/modules/darsh-homebrew`.
Tests: `npm install` then `npm test` (they read the engine's catalogue from a `dnd5e-combat` clone, set `DAS_CORE` to its
path). In-game scenario: `tools/scenarios/`, played with the engine's scenario runner.

Early development. Planned next: exporting a pack as a ready-to-publish module (`.zip`).

## Translations

The module ships English, French and Brazilian Portuguese (pt-BR translation by Henrique, [@henriquebot](https://github.com/henriquebot)); the building blocks' labels come from the engine's own language files. To add a
language, copy `module/lang/en.json` to `module/lang/<code>.json`, translate the values, and add an entry to `languages` in
`module/module.json`; missing keys fall back to English.

## License

MIT. No book text or premium content is shipped.
