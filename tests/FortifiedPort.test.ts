import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { FortifyPortExecution } from "@openfront/engine/execution/FortifyPortExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// half_land_half_ocean is 16x16: land up to x = 7, water from x = 8.
const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

function buildPort(owner: Player, y = 8): Unit {
  return owner.buildUnit(UnitType.Port, game.ref(coastX, y), {});
}

function fortify(owner: Player, port: Unit): void {
  game.addExecution(new FortifyPortExecution(owner, port.id()));
  executeTicks(game, 2);
}

function buildWarship(owner: Player, x: number, y: number): Unit {
  return owner.buildUnit(UnitType.Warship, game.ref(x, y), {
    patrolTile: game.ref(x, y),
  });
}

async function newGame(infiniteGold: boolean): Promise<void> {
  game = await setup(
    "half_land_half_ocean",
    { infiniteGold, instantBuild: true },
    [
      new PlayerInfo("defender", PlayerType.Human, null, "player_1_id"),
      new PlayerInfo("attacker", PlayerType.Human, null, "player_2_id"),
    ],
  );
  player1 = game.player("player_1_id");
  player2 = game.player("player_2_id");
  player1.conquer(game.ref(coastX, 8));
  player2.conquer(game.ref(0, 0));
  executeTicks(game, 5);
}

describe("Fortified port", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("fortifying marks the port and charges the cost once", async () => {
    await newGame(false);
    const cost = game.config().portFortificationCost(player1);
    expect(cost).toBeGreaterThan(0n);
    player1.addGold(cost * 3n);
    const port = buildPort(player1);
    const before = player1.gold();

    fortify(player1, port);
    expect(port.isFortified()).toBe(true);
    expect(before - player1.gold()).toBe(cost);

    // A second order on the same port is refused and costs nothing.
    const afterFirst = player1.gold();
    fortify(player1, port);
    expect(player1.gold()).toBe(afterFirst);
  });

  test("cannot be fortified without enough gold", async () => {
    await newGame(false);
    const port = buildPort(player1);
    player1.removeGold(player1.gold());

    fortify(player1, port);

    expect(port.isFortified()).toBe(false);
  });

  test("only the owner can fortify, and only ports", async () => {
    await newGame(true);
    const port = buildPort(player1);
    const city = player1.buildUnit(UnitType.City, game.ref(2, 8), {});

    fortify(player2, port);
    expect(port.isFortified()).toBe(false);
    expect(player1.canFortifyPort(city)).toBe(false);
  });

  test("an unfortified port does not shoot, a fortified one does", async () => {
    await newGame(true);
    const port = buildPort(player1);
    const warship = buildWarship(player2, coastX + 4, 8);
    const before = warship.health();

    executeTicks(game, 60);
    expect(warship.health()).toBe(before);

    fortify(player1, port);
    executeTicks(game, 60);
    expect(warship.health()).toBeLessThan(before);
  });

  test("the gun goes quiet once the port is destroyed", async () => {
    await newGame(true);
    const port = buildPort(player1);
    fortify(player1, port);
    const warship = buildWarship(player2, coastX + 4, 8);
    port.delete();
    executeTicks(game, 5);
    const before = warship.health();

    executeTicks(game, 60);

    expect(warship.health()).toBe(before);
  });

  test("hardens the land around it like a defense post", async () => {
    // Same attack twice on an all-land map; the only difference is whether
    // the defender's port right behind the border is fortified.
    const tilesTaken = async (fortified: boolean): Promise<number> => {
      const g = await setup(
        "plains",
        { infiniteGold: true, instantBuild: true },
        [
          new PlayerInfo("attacker", PlayerType.Human, null, "attacker"),
          new PlayerInfo("defender", PlayerType.Human, null, "defender"),
        ],
        undefined,
        UseRealAttackLogic,
      );
      const attacker = g.player("attacker");
      const defender = g.player("defender");
      for (let y = 40; y < 60; y++) {
        for (let x = 30; x < 50; x++) attacker.conquer(g.ref(x, y));
        for (let x = 50; x < 70; x++) defender.conquer(g.ref(x, y));
      }
      attacker.setTroops(200_000);
      defender.setTroops(50_000);
      const port = defender.buildUnit(UnitType.Port, g.ref(53, 50), {});
      if (fortified) {
        g.addExecution(new FortifyPortExecution(defender, port.id()));
      }
      executeTicks(g, 3);
      expect(port.isFortified()).toBe(fortified);

      const before = attacker.numTilesOwned();
      g.addExecution(new AttackExecution(20_000, attacker, defender.id()));
      executeTicks(g, 40);
      return attacker.numTilesOwned() - before;
    };

    const open = await tilesTaken(false);
    const hardened = await tilesTaken(true);

    expect(open).toBeGreaterThan(0);
    expect(hardened).toBeLessThan(open);
  });

  test("the fortification survives a snapshot of the unit state", async () => {
    await newGame(true);
    const port = buildPort(player1);
    fortify(player1, port);

    const update = port.toUpdate();

    expect(update.fortified).toBe(true);
  });
});
