import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShellExecution } from "./ShellExecution";

/**
 * A shore structure that shells hostile warships and transport ships within
 * `coastalBatteryRange`. It never targets trade ships: a battery defends a
 * coast, it is not a way to raid commerce.
 */
export class CoastalBatteryExecution implements Execution {
  private mg: Game;
  private active = true;
  private target: Unit | null = null;
  private lastShellAttack = 0;
  // Targets without health die to a single shell; remember them so a second
  // shell is not wasted while the first is still in flight.
  private alreadySentShell = new Set<Unit>();

  constructor(private battery: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.battery.isActive()) {
      this.active = false;
      return;
    }
    if (this.battery.isUnderConstruction()) {
      return;
    }

    if (this.alreadySentShell.size > 0) {
      for (const unit of this.alreadySentShell) {
        if (!unit.isActive()) this.alreadySentShell.delete(unit);
      }
    }

    if (this.target !== null && !this.canTarget(this.target, true)) {
      this.target = null;
    }
    // A transport ship always outranks a warship, so re-evaluate even while a
    // warship is being engaged.
    if (this.target === null || this.target.type() !== UnitType.TransportShip) {
      this.target = this.findTarget() ?? this.target;
    }
    if (this.target === null) {
      return;
    }

    const rate = this.mg.config().coastalBatteryShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack <= rate) {
      return;
    }
    this.lastShellAttack = this.mg.ticks();
    this.mg.addExecution(
      new ShellExecution(
        this.battery.tile(),
        this.battery.owner(),
        this.battery,
        this.target,
      ),
    );
    if (!this.target.hasHealth()) {
      this.alreadySentShell.add(this.target);
      this.target = null;
    }
  }

  private canTarget(unit: Unit, checkRange: boolean): boolean {
    const owner = this.battery.owner();
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
      const range = this.mg.config().coastalBatteryRange();
      if (
        this.mg.euclideanDistSquared(this.battery.tile(), unit.tile()) >
        range * range
      ) {
        return false;
      }
    }
    return true;
  }

  private findTarget(): Unit | undefined {
    const nearby = this.mg.nearbyUnits(
      this.battery.tile(),
      this.mg.config().coastalBatteryRange(),
      [UnitType.TransportShip, UnitType.Warship],
    );
    let best: Unit | undefined = undefined;
    let bestIsTransport = false;
    let bestDistSquared = 0;
    for (const { unit, distSquared } of nearby) {
      if (!this.canTarget(unit, false)) continue;
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

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CoastalBatteryExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      battery: w.unit(this.battery),
      target: w.unitOrNull(this.target),
      lastShellAttack: this.lastShellAttack,
      alreadySentShell: [...this.alreadySentShell].map((u) => w.unit(u)),
    });
  }

  restoreSnapshot(s: CoastalBatteryState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.battery = r.unit(s.battery);
    this.target = r.unitOrNull(s.target);
    this.lastShellAttack = s.lastShellAttack;
    this.alreadySentShell = new Set(s.alreadySentShell.map((i) => r.unit(i)));
  }
}

const CoastalBatteryStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  battery: zRef(),
  target: zRef().nullable(),
  lastShellAttack: zInt(),
  alreadySentShell: z.array(zRef()),
});
type CoastalBatteryState = z.infer<typeof CoastalBatteryStateSchema>;

export const CoastalBatteryExecutionSnapshot = execSnapshotType({
  name: "CoastalBattery",
  version: 1,
  schema: CoastalBatteryStateSchema,
  cls: () => CoastalBatteryExecution,
});
