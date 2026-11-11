import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AllianceRequestExecution } from "@openfront/engine/execution/alliance/AllianceRequestExecution";
import { CoastalBatteryExecution } from "@openfront/engine/execution/CoastalBatteryExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

// half_land_half_ocean is 16x16: land up to x = 7, water from x = 8.
const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

function buildBattery(owner: Player, y = 8): Unit {
  const battery = owner.buildUnit(
    UnitType.CoastalBattery,
    game.ref(coastX, y),
    {},
  );
  game.addExecution(new CoastalBatteryExecution(battery));
  return battery;
}

function buildWarship(owner: Player, x: number, y: number): Unit {
  return owner.buildUnit(UnitType.Warship, game.ref(x, y), {
    patrolTile: game.ref(x, y),
  });
}

describe("CoastalBattery", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("defender", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("attacker", PlayerType.Human, null, "player_2_id"),
      ],
    );
    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
    executeTicks(game, 5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("damages a hostile warship in range", () => {
    buildBattery(player1);
    const warship = buildWarship(player2, coastX + 4, 8);
    const before = warship.health();

    executeTicks(game, 60);

    expect(warship.health()).toBeLessThan(before);
  });

  test("sinks a hostile transport ship", () => {
    buildBattery(player1);
    const transport = player2.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX + 4, 8),
      { troops: 100 },
    );

    executeTicks(game, 60);

    expect(transport.isActive()).toBe(false);
  });

  test("engages the transport ship before the warship", () => {
    buildBattery(player1);
    // The warship is closer, the transport still has to go first.
    const warship = buildWarship(player2, coastX + 2, 8);
    const transport = player2.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX + 6, 8),
      { troops: 100 },
    );
    const before = warship.health();

    // One shell is in the air after the first shot; the reload is longer than
    // this window, so the warship cannot have been shot at yet.
    const reload = game.config().coastalBatteryShellAttackRate();
    let ticks = 0;
    while (transport.isActive() && ticks < reload) {
      game.executeNextTick();
      ticks++;
    }

    expect(transport.isActive()).toBe(false);
    expect(warship.health()).toBe(before);
  });

  test("ignores ships outside its range", () => {
    vi.spyOn(game.config(), "coastalBatteryRange").mockReturnValue(3);
    buildBattery(player1);
    const warship = buildWarship(player2, coastX + 7, 8);
    const before = warship.health();

    executeTicks(game, 60);

    expect(warship.health()).toBe(before);
  });

  test("does not fire at its owner's ships or at trade ships", () => {
    buildBattery(player1);
    const ownWarship = buildWarship(player1, coastX + 3, 6);
    const port = player2.buildUnit(UnitType.Port, game.ref(coastX, 2), {});
    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 3, 10),
      { targetUnit: port },
    );
    const before = ownWarship.health();

    executeTicks(game, 60);

    expect(ownWarship.health()).toBe(before);
    expect(tradeShip.isActive()).toBe(true);
    expect(game.units(UnitType.Shell)).toHaveLength(0);
  });

  test("does not fire at an ally's warship", () => {
    // Alliance requests need both players to be alive (own a tile).
    player1.conquer(game.ref(coastX, 8));
    player2.conquer(game.ref(0, 0));
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    executeTicks(game, 2);
    expect(player1.isAlliedWith(player2)).toBe(true);

    buildBattery(player1);
    const warship = buildWarship(player2, coastX + 4, 8);
    const before = warship.health();

    executeTicks(game, 60);

    expect(warship.health()).toBe(before);
  });

  test("stops firing once it is destroyed", () => {
    const battery = buildBattery(player1);
    const warship = buildWarship(player2, coastX + 4, 8);
    battery.delete();
    // Let shells that might already be in flight resolve.
    executeTicks(game, 5);
    const before = warship.health();

    executeTicks(game, 60);

    expect(warship.health()).toBe(before);
  });

  test("can only be placed on the shore", () => {
    for (let y = 6; y <= 10; y++) {
      player1.conquer(game.ref(coastX, y));
      player1.conquer(game.ref(0, y));
    }

    const onShore = player1.canBuild(
      UnitType.CoastalBattery,
      game.ref(coastX, 8),
    );
    expect(onShore).not.toBe(false);
    expect(game.isShore(onShore as number)).toBe(true);

    // Far inland with no shore tile within reach of the click.
    expect(player1.canBuild(UnitType.CoastalBattery, game.ref(0, 8))).toBe(
      false,
    );
  });

  test("is built through the construction flow and then fires", () => {
    for (let y = 6; y <= 10; y++) {
      player1.conquer(game.ref(coastX, y));
    }
    constructionExecution(game, player1, coastX, 8, UnitType.CoastalBattery);
    expect(player1.units(UnitType.CoastalBattery)).toHaveLength(1);

    const warship = buildWarship(player2, coastX + 4, 8);
    const before = warship.health();
    executeTicks(game, 60);

    expect(warship.health()).toBeLessThan(before);
  });
});
