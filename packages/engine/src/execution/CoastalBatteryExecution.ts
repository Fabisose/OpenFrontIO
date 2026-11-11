import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShoreGun, ShoreGunStateSchema } from "./utils/ShoreGun";

/**
 * A shore structure that shells hostile warships and transport ships within
 * `coastalBatteryRange`. See ShoreGun for the targeting rules.
 */
export class CoastalBatteryExecution implements Execution {
  private mg: Game;
  private active = true;
  private gun = new ShoreGun();

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
    this.gun.tick(this.mg, this.battery);
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
      ...this.gun.snapshot(w),
    });
  }

  restoreSnapshot(s: CoastalBatteryState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.battery = r.unit(s.battery);
    this.gun = new ShoreGun();
    this.gun.restoreSnapshot(s, r);
  }
}

const CoastalBatteryStateSchema = ShoreGunStateSchema.extend({
  active: z.boolean(),
  initialized: z.boolean(),
  battery: zRef(),
});
type CoastalBatteryState = z.infer<typeof CoastalBatteryStateSchema>;

export const CoastalBatteryExecutionSnapshot = execSnapshotType({
  name: "CoastalBattery",
  version: 1,
  schema: CoastalBatteryStateSchema,
  cls: () => CoastalBatteryExecution,
});
