# Fork notes (Fabisose/OpenFrontIO)

Handover notes for whoever continues this fork, human or AI. It records what
this fork adds on top of upstream OpenFront, how the work was done, and what is
still open. Read `CLAUDE.md` first for the upstream architecture and rules; this
file only covers what is specific to the fork.

Goal of the fork: a private OpenFront to play with friends, with a deeper navy
and industry than upstream.

## Repository setup

- `origin` = `git@github.com:Fabisose/OpenFrontIO.git` (the fork, SSH).
- `upstream` = `https://github.com/openfrontio/OpenFrontIO.git`.
- Work is committed directly on `main` and pushed to `origin` (owner's choice).
- The fork was created at upstream commit `d03f24a6d`.
- `gh` is not installed on the owner's laptop; use plain `git` over SSH.

Licensing, because it limits what may be changed: code is AGPL v3 (keep the
"© OpenFront and Contributors" notices visible, publish modified source — the
public fork does that). `resources/` is CC BY-SA 4.0. `proprietary/` is all
rights reserved: do not modify it or copy from it. All icons added by this fork
are original drawings.

## Running it

The project needs Node 24 / npm 12; the laptop has Node 18. Everything runs in
a `node:24` Docker container instead of touching the system:

```bash
bash scripts/dev-docker.sh          # dev server, client on http://localhost:9000
INSTALL=1 bash scripts/dev-docker.sh  # same, but reinstall dependencies first
```

- The script uses `--network host` and `npm run dev:host`, so friends on the
  same network can open `http://<LAN-IP>:9000`. Not yet tested from a second
  device. Internet play needs a tunnel or hosting; nothing is set up.
- npm 12 and its cache live in the Docker volume `openfront-home`.
- "Connection refused" errors in the browser console come from the closed
  account API (login, store, stats) that is not part of the repo. Solo and
  private lobbies work without it.

Running one-off commands (tests, lint) in the same environment:

```bash
docker run --rm --memory 6g --memory-swap 6g --cpus 6 \
  -u "$(id -u):$(id -g)" -e HOME=/h -e NPM_CONFIG_PREFIX=/h/.npm-global \
  -v openfront-home:/h -v "$PWD":/app -w /app node:24 \
  bash -c 'export PATH=/h/.npm-global/bin:$PATH; npm run lint'
```

### Do not run the full test suite on this laptop

`npm test` and `npm run test:changed` crashed the laptop twice (15 GB RAM,
both crashes happened during that run). Always:

- keep the `--memory 6g --cpus 6` limits on the container, and
- run targeted files with few workers:
  `npx vitest --run --maxWorkers=3 tests/FortifiedPort.test.ts ...`

Sets that cover the fork's changes and are known to pass:

- Fast: `tests/CoastalBattery.test.ts tests/FortifiedPort.test.ts
  tests/core/game/PackedUnitUpdates.test.ts tests/client/replay
  tests/client/UnitDisplay.test.ts tests/client/render tests/client/view
  tests/Warship.test.ts tests/InputHandler.test.ts`
- Slow (use `--maxWorkers=2`): `tests/core/snapshot
  tests/core/WinnerReplay.test.ts tests/NationStructureBehavior.test.ts
  tests/LayerBoundaries.test.ts`

In the one full run that finished, six tests in
`tests/client/MainInitialize.test.ts`, `tests/client/InventoryModal.test.ts`
and `tests/client/PlayerName.test.ts` failed under load and passed when run on
their own. They were not checked against an unmodified checkout.

Before committing, also run `npm run typecheck`, `npm run lint` and `npx oxfmt
<changed files>`.

## What the fork adds

### 1. Coastal Battery (commit `04f65a06b`)

A new structure, `UnitType.CoastalBattery = "Coastal Battery"`.

- Placed on shore tiles only (same placement rule as a port).
- Shells hostile warships and transport ships within
  `coastalBatteryRange()` (110), transports first, one shell every
  `coastalBatteryShellAttackRate()` (30) ticks.
- Never fires at trade ships, allies, its owner's ships or docked warships.
- Cost: `min(800k, (n + 1) * 200k)`. Build time 100 ticks.
- Hotkey V, build menu and hotbar entry, range preview while placing.
- Nations build at most two, one per port, once they own two cities
  (`maybeBuildCoastalBattery` in `NationStructureBehavior.ts`).

### 2. Fortified port (commits `14495fa89`, `4f54d06ef`)

Not a new unit type: a `fortified` flag on a `Port` unit.

- Triggered from the radial menu: right-click own land within 5 tiles of an
  own, finished, unfortified port. The entry replaces the alliance slot and
  shows title, description and cost.
- One-off cost `portFortificationBaseCost()` (500k); free with infinite gold.
- Effects: the port fires like a coastal battery; land within
  `defensePostRange()` defends like around a defense post; docked warships
  repair `fortifiedPortHealingMultiplier()` (2x) faster.
- The flag stays on the unit, so a captured port stays fortified and the gun
  then fires for the new owner.
- Drawn as an octagon with a battlement-and-anchor icon.

## Where things live

Engine (deterministic, must have tests, see `CLAUDE.md`):

| File                                                                                                   | What                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `packages/engine/src/execution/utils/ShoreGun.ts`                                                      | Shared targeting and firing for both features, with its snapshot schema                              |
| `packages/engine/src/execution/CoastalBatteryExecution.ts`                                             | Per-battery execution, delegates to `ShoreGun`                                                       |
| `packages/engine/src/execution/FortifyPortExecution.ts`                                                | Pays and sets the flag in `init`, then stays alive as the port's gun                                 |
| `packages/engine/src/game/UnitImpl.ts`                                                                 | `isFortified` / `setFortified`, `fortified` in `toUpdate`, Unit snapshot v2 with a migration from v1 |
| `packages/engine/src/game/PlayerImpl.ts`                                                               | `canFortifyPort` / `fortifyPort`; `CoastalBattery` uses `portSpawn`                                  |
| `packages/engine/src/execution/AttackExecution.ts`                                                     | `hasFortifiedPortNearby` feeds the existing `defenderHasDefensePost` flag                            |
| `packages/engine/src/execution/WarshipExecution.ts`                                                    | Healing multiplier in `applyActiveDockedHealing`                                                     |
| `packages/engine/src/configuration/EngineConfig.ts`, `packages/engine-lib/src/configuration/Config.ts` | Costs, range, fire rate                                                                              |
| `packages/engine-api/src/Schemas.ts`                                                                   | `fortify_port` intent                                                                                |
| `packages/engine-lib/src/game/PackedUnitUpdates.ts`                                                    | Unit type index 17; `fortified` is bit 29 of packed A                                                |

Client:

| File                                                                                         | What                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/client/hud/layers/BuildMenu.ts`, `UnitDisplay.ts`, `src/client/hud/HotbarIcons.ts`      | Build menu and hotbar entries                                |
| `src/client/UserSettings.ts`, `InputHandler.ts`, `UserSettingModal.ts`                       | `buildCoastalBattery` keybind (default `KeyV`)               |
| `src/client/hud/layers/RadialMenuElements.ts`                                                | `fortifyPortElement(params)`                                 |
| `src/client/Transport.ts`                                                                    | `SendFortifyPortIntentEvent`                                 |
| `src/client/render/types/UnitType.ts`                                                        | `UT_COASTAL_BATTERY`, render-only `UT_FORTIFIED_PORT`        |
| `src/client/render/gl/passes/StructurePass.ts`, `StructureLevelPass.ts`                      | Atlas column order; fortified ports use `FORTIFIED_PORT_COL` |
| `src/client/render/gl/shaders/structure/structure.frag.glsl`                                 | Shape per atlas column (6 = diamond, 7 = octagon)            |
| `src/client/render/gl/render-settings.json`                                                  | Scale, icon fill and light per structure                     |
| `resources/atlases/icon-atlas.png`                                                           | 64 px columns, now 8 wide (512x64)                           |
| `src/client/view/GameView.ts`                                                                | Structure buffer is rebuilt when `fortified` changes         |
| `src/client/view/EntityState.ts`, `render/types/Renderer.ts`, `replay/codec/EntitySchema.ts` | `fortified` in the client unit state and replay codec        |

Tests: `tests/CoastalBattery.test.ts`, `tests/FortifiedPort.test.ts`.
`tests/util/ScriptedGame.ts` builds batteries and fortifies ports so the
full-game snapshot test exercises both executions.

## Recipes learned the hard way

### Adding a new structure type

Typecheck finds most places through `assertNever`, but not all. Checklist:

1. `GameTypes.ts`: enum value, add to `Structures`.
2. `PackedUnitUpdates.ts`: append to `PACKED_UNIT_TYPES` (5 bits, max 31
   types; 17 used).
3. `Config.unitInfo`, `EngineConfig.unitCost`, `Game.ts` `UnitParamsMap`,
   `PlayerImpl.canSpawnUnitType`, `ConstructionExecution` (execution and
   `isStructure`).
4. New execution with `snapshot` / `restoreSnapshot`, registered in
   `snapshot/ExecutionRegistry.ts`.
5. Client render: `UT_*` constant plus `STRUCTURE_TYPES` and `ALL_UNIT_TYPES`,
   `STRUCTURE_ORDER` in both structure passes (same order), a shape branch in
   `structure.frag.glsl`, `shapes` and `lightConfigs` in
   `render-settings.json`, `LIGHT_CONFIGS` in `PointLightPass.ts`, and a new
   64 px column appended to `icon-atlas.png` (drawn with Python/PIL here).
6. Client UI: `BuildMenu.ts`, hotbar (`UnitDisplay.ts`, a test requires every
   `BuildMenus` type there), keybind, `BuildPreviewController` range,
   `SoundEffectController`, `GameConfigSettings`, `LobbySettingsSummary`,
   `SinglePlayerModal` tutorial list, `resources/lang/en.json`.
7. `tests/util/ScriptedGame.ts`: the full-game snapshot test fails unless every
   registered execution type actually runs in the scripted game.

### Adding state to a unit

- Bump `UnitSnapshot.version` and add a migration (see
  `packages/engine/src/snapshot/README.md`).
- Packed B has no free bits; packed A has bits 30 and 31 left.
- Leave an optional field out of the update when it is unset, otherwise the
  round-trip tests in `PackedUnitUpdates.test.ts` fail.
- Add the field to `UnitState` (`Renderer.ts`), `EntityState.ts` (two places),
  `EntitySchema.ts` and `PreviewAnimationTicker.ts`, and to the `UnitState`
  literals in about eight test files. In `EntitySchema.test.ts` the
  "alternatives" object needs a value different from the base one.
- If the field changes how a structure is drawn, add it to the
  `_structuresDirty` check in `GameView.ts` or the map will not update.

### Checking in the running game

Solo → scroll to Options → Instant Build and Infinite Gold → Start. Spawn on a
coast. `3` then click builds a port, `V` then click a battery, right-click next
to the port opens the radial menu. The tutorial panel can be skipped. In the
solo options a click toggles, so check the button state before starting.

## Open work

Agreed with the owner, in this order:

1. **Destroyer and battleship.** Cheap fast ship versus expensive slow one
   with long range and shore bombardment.
2. **Submarine.** Hidden from enemies, hunts trade ships and transports, only
   detectable by nearby warships. The simulation runs on every client, so
   stealth can only be a display rule, not real secrecy.
3. **Aircraft carrier.** Strikes inland targets. By far the largest change.
4. **Industry.** Not designed yet; the owner wants production chains beyond
   the existing factory and trains.

Smaller gaps:

- Nations never fortify their ports.
- No stats entries for the new structure (`StatsSchemas.ts` was left alone on
  purpose; the unit stats switches in `UnitImpl.ts` skip it).
- Only `en.json` has the new texts. `CLAUDE.md` reserves the other language
  files for Crowdin; the owner plays in German, so decide with them whether to
  break that rule in this fork.
- The fortify button ignores the host-cheat variant of infinite gold when it
  greys itself out (`fortifyPortCost` only checks `gameConfig().infiniteGold`).
- Coastal battery combat and the faster repair at fortified ports were verified
  by tests or not at all, not by staging a fight in the running game.
- Merging newer upstream commits has not been tried since the fork.
