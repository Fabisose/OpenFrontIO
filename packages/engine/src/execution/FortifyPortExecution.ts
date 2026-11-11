import {
  zNum,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShoreGun, ShoreGunStateSchema } from "./utils/ShoreGun";

/**
 * Turns a port into a fortified port (paid once) and then stays alive as that
 * port's gun for as long as the port exists and remains fortified. The gun
 * follows the port: whoever captures a fortified port also gets its gun.
 */
export class FortifyPortExecution implements Execution {
  private mg: Game;
  private active = true;
  private port: Unit | undefined;
  private gun = new ShoreGun();

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const port = mg.unit(this.unitId);
    if (port === undefined || !this.player.canFortifyPort(port)) {
      console.warn(
        `[FortifyPortExecution] port ${this.unitId} cannot be fortified`,
      );
      this.active = false;
      return;
    }
    this.player.fortifyPort(port);
    this.port = port;
  }

  tick(ticks: number): void {
    const port = this.port;
    if (port === undefined || !port.isActive() || !port.isFortified()) {
      this.active = false;
      return;
    }
    this.gun.tick(this.mg, port);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FortifyPortExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      unitId: this.unitId,
      port: this.port === undefined ? null : w.unit(this.port),
      ...this.gun.snapshot(w),
    });
  }

  restoreSnapshot(s: FortifyPortState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.unitId = s.unitId;
    this.port = s.port === null ? undefined : r.unit(s.port);
    this.gun = new ShoreGun();
    this.gun.restoreSnapshot(s, r);
  }
}

const FortifyPortStateSchema = ShoreGunStateSchema.extend({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  unitId: zNum(),
  port: zRef().nullable(),
});
type FortifyPortState = z.infer<typeof FortifyPortStateSchema>;

export const FortifyPortExecutionSnapshot = execSnapshotType({
  name: "FortifyPort",
  version: 1,
  schema: FortifyPortStateSchema,
  cls: () => FortifyPortExecution,
});
