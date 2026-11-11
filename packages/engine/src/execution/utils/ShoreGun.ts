import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Game, Unit } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ShellExecution } from "../ShellExecution";

export const ShoreGunStateSchema = z.object({
  target: zRef().nullable(),
  lastShellAttack: zInt(),
  alreadySentShell: z.array(zRef()),
});
export type ShoreGunState = z.infer<typeof ShoreGunStateSchema>;

/**
 * The gun of a shore structure (coastal battery, fortified port): shells
 * hostile warships and transport ships within `coastalBatteryRange`, transport
 * ships first. It never targets trade ships, allies or docked warships.
 */
export class ShoreGun {
  private target: Unit | null = null;
  private lastShellAttack = 0;
  // Targets without health die to a single shell; remember them so a second
  // shell is not wasted while the first is still in flight.
  private alreadySentShell = new Set<Unit>();

  /** Call once per tick while `structure` is active and built. */
  tick(mg: Game, structure: Unit): void {
    if (this.alreadySentShell.size > 0) {
      for (const unit of this.alreadySentShell) {
        if (!unit.isActive()) this.alreadySentShell.delete(unit);
      }
    }

    if (this.target !== null && !this.canTarget(mg, structure, this.target)) {
      this.target = null;
    }
    // A transport ship always outranks a warship, so re-evaluate even while a
    // warship is being engaged.
    if (this.target === null || this.target.type() !== UnitType.TransportShip) {
      this.target = this.findTarget(mg, structure) ?? this.target;
    }
    if (this.target === null) {
      return;
    }

    const rate = mg.config().coastalBatteryShellAttackRate();
    if (mg.ticks() - this.lastShellAttack <= rate) {
      return;
    }
    this.lastShellAttack = mg.ticks();
    mg.addExecution(
      new ShellExecution(
        structure.tile(),
        structure.owner(),
        structure,
        this.target,
      ),
    );
    if (!this.target.hasHealth()) {
      this.alreadySentShell.add(this.target);
      this.target = null;
    }
  }

  private canTarget(
    mg: Game,
    structure: Unit,
    unit: Unit,
    checkRange = true,
  ): boolean {
    const owner = structure.owner();
    if (
      !unit.isActive() ||
      unit.owner() === owner ||
      !owner.canAttackPlayer(unit.owner(), true) ||
      this.alreadySentShell.has(unit)
    ) {
      return false;
    }
    if (
      unit.type() === UnitType.Warship &&
      unit.warshipState().state === "docked"
    ) {
      return false;
    }
    if (checkRange) {
      const range = mg.config().coastalBatteryRange();
      if (
        mg.euclideanDistSquared(structure.tile(), unit.tile()) >
        range * range
      ) {
        return false;
      }
    }
    return true;
  }

  private findTarget(mg: Game, structure: Unit): Unit | undefined {
    const nearby = mg.nearbyUnits(
      structure.tile(),
      mg.config().coastalBatteryRange(),
      [UnitType.TransportShip, UnitType.Warship],
    );
    let best: Unit | undefined = undefined;
    let bestIsTransport = false;
    let bestDistSquared = 0;
    for (const { unit, distSquared } of nearby) {
      if (!this.canTarget(mg, structure, unit, false)) continue;
      const isTransport = unit.type() === UnitType.TransportShip;
      if (
        best === undefined ||
        (isTransport && !bestIsTransport) ||
        (isTransport === bestIsTransport && distSquared < bestDistSquared)
      ) {
        best = unit;
        bestIsTransport = isTransport;
        bestDistSquared = distSquared;
      }
    }
    return best;
  }

  snapshot(w: SnapshotWriter): ShoreGunState {
    return {
      target: w.unitOrNull(this.target),
      lastShellAttack: this.lastShellAttack,
      alreadySentShell: [...this.alreadySentShell].map((u) => w.unit(u)),
    };
  }

  restoreSnapshot(s: ShoreGunState, r: SnapshotReader): void {
    this.target = r.unitOrNull(s.target);
    this.lastShellAttack = s.lastShellAttack;
    this.alreadySentShell = new Set(s.alreadySentShell.map((i) => r.unit(i)));
  }
}
