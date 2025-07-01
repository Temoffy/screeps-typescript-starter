/*
Telos, ᏘᎼᏗ
June 2025
screeps bot rewrite based on https://github.com/screepers/screeps-typescript-starter
reason: had enough of type errors in runtime
*/

import { ErrorMapper } from "utils/ErrorMapper";
import jobBoard from "./jobBoard";
import worker from "./worker";
import hauler from "./hauler";
import harvester from "./harvester";
import combat from "./combat";

declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implementation if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
    roomInfo: MapMem;
    states: StateEntity[];
    jobs: Job[];
  }

  interface CreepMemory {
    role: string;
    room: string;
  }

  type Job = TransferJob | UpgradeJob | ConstructionJob | RepairJob | HarvestJob;

  type TransferJob = {
    readonly type: string;
    readonly target: Id<AnyStoreStructure>;
    readonly pos: RoomPosition;
    amount: number;
    resourceType: ResourceConstant | "any";
    priority: number;
    rank: number;
    tick: number;
    active: number;
    readonly id: number;
  };
  type UpgradeJob = {
    readonly type: string;
    readonly target: Id<StructureController>;
    readonly pos: RoomPosition;
    amount: number;
    priority: number;
    tick: number;
    active: number; //todo strip this out and swap amount to workparts
    readonly id: number;
  };
  type ConstructionJob = {
    readonly type: string;
    readonly target: Id<ConstructionSite>;
    readonly pos: RoomPosition;
    amount: number;
    priority: number;
    active: number;
    readonly id: number;
  };
  type RepairJob = {
    readonly type: string;
    readonly target: Id<AnyStructure>[];
    readonly pos: RoomPosition;
    amount: number;
    priority: number;
    active: number;
    readonly id: number;
  };
  type HarvestJob = {
    readonly type: string;
    readonly target: Id<Source> | Id<Mineral>;
    readonly pos: RoomPosition;
    amount: number;
    tick: number;
    priority: number;
    active: number;
    readonly id: number;
  };

  type StateEntity = CreepState | TowerState | SpawnState;

  type CreepState = {
    readonly type: string;
    readonly id: Id<Creep>;
    readonly role: string;
    commands: Command[];
    info: {
      remove: boolean;
      workParts: number;
      cargo?: { [key: string]: number };
      working: boolean;
      moving: boolean;
      pos: RoomPosition;
    };
  };
  type Command = {
    readonly type: string;
    target: Id<AnyStructure | Creep | Source | Mineral | Resource | Tombstone | Ruin>;
    pos: RoomPosition;
    amount: number;
    readonly job?: number;
    readonly source?: SourcesMem; //todo remove when swapped over to new tasks
    readonly resourceType?: ResourceConstant;
  };
  type TowerState = {
    readonly type: "tower";
    readonly id: Id<StructureTower>;
    info: {
      remove: boolean;
      target?: Id<Creep> | Id<PowerCreep>;
    };
  };
  type SpawnState = {
    readonly type: "spawn";
    readonly id: Id<StructureSpawn>;
    info: {
      remove: false;
    };
  };

  type MapMem = {
    [key: string]: RoomMem;
  };
  type RoomMem = {
    sources: SourcesMem[];
    containers: { [key: string]: ContainerMem };
    minerals: MineralsMem[];
    enemyPresence: boolean;
    updated: boolean;
  };
  type SourcesMem = {
    spaces: number;
    workCap: number;
    id: Id<Source>;
    readonly pos: RoomPosition;
    container?: Id<AnyStoreStructure>;
  };
  type ContainerMem = {
    readonly pos: RoomPosition;
    rank: number;
    store: { [key: string]: number };
    active: number;
  };
  type MineralsMem = {
    spaces: number;
    concentration: number;
    type: string;
    id: Id<Mineral>;
    readonly pos: RoomPosition;
    container?: Id<AnyStoreStructure>;
  };

  type ContainerAdd = {
    roomId: string;
    containerId: Id<AnyStoreStructure>;
    amount: number;
    type: string;
  };

  // Syntax for adding properties to `global` (ex "global.log")
  namespace NodeJS {
    interface Global {
      log: any;
      cli: Cli;
      tools: Tools;
      map: MapInfo;
      scheduler: Scheduler;
    }
  }
}

class Tools {
  public HasStore<T extends Object>(
    obj: T
  ): obj is {
    store: StoreDefinition | StoreDefinitionUnlimited | Store<ResourceConstant, false>;
  } & T {
    return "store" in obj;
  }
  public IsTransferJob<T extends Object>(
    obj: T
  ): obj is TransferJob & T {
    return "type" in obj && obj.type == "deliver";
  }
  public BodyCost = function (body: BodyPartConstant[]) {
    let cost = 0;
    for (let i in body) {
      cost = cost + BODYPART_COST[body[i]];
    }
    return cost;
  };
}
global.tools = new Tools();

class Cli {
  public KillMem() {
    global.scheduler.health -= 5;
    console.log("KillingMem");
  }
}
class MapInfo {
  public rooms: MapMem = Memory.roomInfo || {};
  public containerAdd: ContainerAdd[] = [];
  public queueUpdates() {
    for (let id in this.rooms) {
      this.rooms[id].updated = false;
      global.scheduler.mapUpdate++;
    }
  }
  public updateRoom(roomID: string) {
    if (!Game.rooms[roomID]) return;

    let roomMem = this.rooms[roomID];
    let room = Game.rooms[roomID];
    if ((!roomMem || roomMem.updated == false) && room) {
      this.rooms[roomID] = { sources: [], containers: {}, minerals: [], enemyPresence: false, updated: true };
      roomMem = this.rooms[roomID];
      const terrain = new Room.Terrain(roomID);

      let rawSources = room.find(FIND_SOURCES);
      for (let item of rawSources) {
        //tally up spaces that are not walls surrounding a source, get max num of harvesters
        let space = 0;
        let directions = [1, 0, -1];
        let sourcePosX = item.pos.x;
        let sourcePosY = item.pos.y;
        for (let xdirection of directions) {
          for (let ydirection of directions) {
            if (terrain.get(sourcePosX + xdirection, sourcePosY + ydirection) != TERRAIN_MASK_WALL) {
              space++;
            }
          }
        }

        roomMem.sources.push({
          spaces: space,
          workCap: 5,
          id: item.id,
          pos: item.pos
        });
      }

      let rawMinerals = room.find(FIND_MINERALS);
      for (let item of rawMinerals) {
        //tally up spaces that are not walls surrounding a source, get max num of harvesters
        let space = 0;
        let directions = [1, 0, -1];
        let sourcePosX = item.pos.x;
        let sourcePosY = item.pos.y;
        for (let xdirection of directions) {
          for (let ydirection of directions) {
            if (terrain.get(sourcePosX + xdirection, sourcePosY + ydirection) != TERRAIN_MASK_WALL) {
              space++;
            }
          }
        }

        if (!roomMem.minerals) {
          roomMem.minerals = [];
        }
        roomMem.minerals?.push({
          spaces: space,
          concentration: item.density,
          type: item.mineralType,
          id: item.id,
          pos: item.pos
        });
      }
    }
    roomMem.enemyPresence = false
    //todo fix source workparts to be proper per room regen rate
    let username = Game.rooms[roomID].controller?.owner?.username;
    if (username && username != "Temoffy") {
      roomMem.enemyPresence = true;
    }
    if(room.find(FIND_HOSTILE_CREEPS).length>0 && !(username && username == "Temoffy")) roomMem.enemyPresence = true


    for (let container in roomMem.containers) {
      if (!Game.getObjectById(container)) {
        delete roomMem.containers[container];
      }
    }
    let containers: (AnyStructure | Resource | Ruin | Tombstone)[] = room.find(FIND_STRUCTURES, {
      filter: structure =>
        structure.structureType == STRUCTURE_STORAGE || structure.structureType == STRUCTURE_CONTAINER
    });
    containers = [
      ...containers,
      ...room.find(FIND_DROPPED_RESOURCES),
      ...room.find(FIND_RUINS),
      ...room.find(FIND_TOMBSTONES)
    ];
    for (let container of containers as (AnyStoreStructure | Resource | Ruin | Tombstone)[]) {
      if (
        roomMem.containers[container.id] &&
        (container instanceof StructureContainer || container instanceof StructureStorage)
      ) {
        let containerMem = roomMem.containers[container.id];
        if (containerMem.active == 0) {
          for (let id in container.store) {
            if (container.store[id as ResourceConstant] != containerMem.store[id]) {
              console.log(
                "ENERGY TRACKING BROKE FOR " + JSON.stringify(containerMem) + "  " + JSON.stringify(container.store)
              );
              containerMem.store[id] = container.store[id as ResourceConstant];
            }
          }
        }
        continue; //todo: add reconciliation checks here
      }
      let rank = 1;
      let store: { [key: string]: number } = {};
      if (container instanceof Resource) {
        rank = 0;
        store[container.resourceType] = container.amount;
      } else {
        if (container instanceof Ruin || container instanceof Tombstone) {
          if (container.store?.getUsedCapacity() == 0) continue;
          rank = 0;
        } else if (container instanceof StructureStorage) rank = 2;
        for (let id in container.store) {
          store[id] = container.store[id as ResourceConstant];
        }
        if (!roomMem.containers) roomMem.containers = {};
        roomMem.containers[container.id] = {
          pos: container.pos,
          rank: rank,
          store: store,
          active: 0
        };
      }
    }

    for (let item of roomMem.sources) {
      if (!item.container || !Game.getObjectById(item.container)) {
        let sourcePos = new RoomPosition(item.pos.x, item.pos.y, item.pos.roomName);
        let containers = sourcePos.findInRange(FIND_STRUCTURES, 1, {
          filter: structure =>
            structure.structureType == STRUCTURE_STORAGE || structure.structureType == STRUCTURE_CONTAINER
        });
        if (containers.length > 0) {
          item.container = containers[0].id as Id<AnyStoreStructure>;
          roomMem.containers ? (roomMem.containers[containers[0].id].rank = 1) : undefined;
        } else {
          item.container = undefined;
        }
      }
    }
    let minerals = roomMem.minerals;
    if (minerals) {
      for (let item of minerals) {
        if (!item.container || !Game.getObjectById(item.container)) {
          let mineralPos = new RoomPosition(item.pos.x, item.pos.y, item.pos.roomName);
          let containers = mineralPos.findInRange(FIND_STRUCTURES, 1, {
            filter: structure =>
              structure.structureType == STRUCTURE_STORAGE || structure.structureType == STRUCTURE_CONTAINER
          });
          if (containers.length > 0) {
            item.container = containers[0].id as Id<AnyStoreStructure>;
          } else {
            item.container = undefined;
          }
        }
      }
    }
  }
  public updateMap() {
    for (let roomName in Game.rooms) {
      this.updateRoom(roomName);
    }
  }

  public getSourceFromID(id: string) {
    for (let roomID in this.rooms) {
      for (let mapSource of this.rooms[roomID].sources) {
        if (mapSource.id == id) {
          return mapSource;
        }
      }
    }
    return undefined;
  }
  public getMineralFromID(id: string) {
    for (let roomID in this.rooms) {
      let room = this.rooms[roomID];
      for (let mapMineral of room.minerals ? room.minerals : []) {
        if (mapMineral.id == id) {
          return mapMineral;
        }
      }
    }
    return undefined;
  }

  public maxDistance(pos1: RoomPosition, pos2: RoomPosition) {
    let gpos1 = this.getWorldCoord(pos1);
    let gpos2 = this.getWorldCoord(pos2);
    let xDiff = Math.abs(gpos1.x - gpos2.x);
    let yDiff = Math.abs(gpos1.y - gpos2.y);
    let maxDistance = Math.max(xDiff, yDiff);
    return maxDistance;
  }

  public getWorldCoord(pos: RoomPosition) {
    let { x, y, roomName } = pos;
    if (x < 0 || x > 49) throw new RangeError("x value " + x + " not in range");
    if (y < 0 || y > 49) throw new RangeError("y value " + y + " not in range");
    if (roomName == "sim") throw new RangeError("Sim room does not have world position");
    let [name, h, wxs, v, wys] = roomName.match(/^([WE])([0-9]+)([NS])([0-9]+)$/) as RegExpMatchArray;
    let [wx, wy] = [parseInt(wxs), parseInt(wys)];

    if (h == "W") wx = ~wx;
    if (v == "N") wy = ~wy;
    return { x: 50 * wx + x, y: 50 * wy + y };
  }
}
global.cli = new Cli();

console.log("restart!");

const names = [
  "Robert",
  "John",
  "James",
  "William",
  "Charles",
  "George",
  "Joseph",
  "Richard",
  "Edward",
  "Donald",
  "Thomas",
  "Frank",
  "Harold",
  "Paul",
  "Raymond",
  "Walter",
  "Jack",
  "Henry",
  "Kenneth",
  "Arthur",
  "Albert",
  "David",
  "Harry",
  "Eugene",
  "Ralph",
  "Howard",
  "Carl",
  "Willie",
  "Louis",
  "Clarence",
  "Earl",
  "Roy",
  "Fred",
  "Joe",
  "Francis",
  "Lawrence",
  "Herbert",
  "Leonard",
  "Ernest",
  "Alfred",
  "Anthony",
  "Stanley",
  "Norman",
  "Gerald"
];
//data not about my units, array of rooms
Memory.states = [];
Memory.jobs = [];
Memory.roomInfo = {};
global.map = new MapInfo();
global.map.updateMap();
//track entities and their info, every state associative array must have a type and id property
let states: StateEntity[] = Memory.states || [];
//array of job objects
let jobs: Job[] = Memory.jobs || [];
jobBoard.update(jobs);

class Scheduler {
  //all rest variables must be <=0
  health = 0;
  jobUpdate = 1;
  jobRest = -10;
  stateUpdate = 1;
  stateRest = 0;
  mapUpdate = 1;
  mapRest = 0;

  startTick() {
    /*if(this.health < -2){
      console.log("code sick, kill it")
      states = []
      Memory.states = []
      jobs = []
      Memory.jobs = []
      map = {}
      Memory.map = {}
      this.health = 0
      return
    }*/
    this.health--;
    if (this.mapUpdate < 0) {
      this.mapUpdate++;
    }
    if (this.jobUpdate < 0) {
      this.jobUpdate++;
    }
    if (this.stateUpdate < 0) {
      this.stateUpdate++;
    }

    if (Game.cpu.bucket > 10) {
      if ((Game.time % 50 == 0 && this.mapUpdate >= 0) || this.mapUpdate > 0) {
        global.map.updateMap();
        this.mapUpdate = this.mapRest;

        Memory.states = states;
        Memory.jobs = jobs;
        Memory.roomInfo = global.map.rooms;
      }
      if (
        (Game.time % 50 == 0 && this.jobUpdate >= 0) ||
        (Game.time % 10 == 0 && this.jobUpdate >= 0 && jobs.length < 2) ||
        this.jobUpdate > 0
      ) {
        jobBoard.update(jobs);
        //don't immediately redo, returned to 0 over several ticks at start of loop
        this.jobUpdate = this.jobRest;

        Memory.states = states;
        Memory.jobs = jobs;
        Memory.roomInfo = global.map.rooms; //can change based on source claiming, ect.
      }
      if ((Game.time % 50 == 0 && this.stateUpdate >= 0) || this.stateUpdate > 0) {
        stateUpdate(states);
        this.stateUpdate = this.stateRest;

        for (const name in Memory.creeps) {
          if (!(name in Game.creeps)) {
            delete Memory.creeps[name];
          }
        }
      }
    }
  }

  endTick() {
    for (let i of global.map.containerAdd) {
      global.map.rooms[i.roomId].containers[i.containerId].store[i.type] += i.amount;
    }
    global.map.containerAdd = [];

    //confirms code completed, see top of loop
    this.health++; //counteract -- at the top
    if (this.health < 0) {
      this.health += 0.5; //bring back towards 0
    }
    Memory.states = states;
    Memory.jobs = jobs;
    Memory.roomInfo = global.map.rooms;
  }
}

global.scheduler = new Scheduler();

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
  global.scheduler.startTick();

  //iterate over all available actors
  if (states.length && states.length > 0) {
    for (let entity of states) {
      let gameEntity = Game.getObjectById(entity.id);
      if (gameEntity == null || entity.info.remove) {
        entity.info.remove = true;
        global.scheduler.stateUpdate++;
      }

      switch (entity.type) {
        case "creep":
          gameEntity = gameEntity as Creep;
          if (gameEntity && gameEntity.ticksToLive == undefined) {
            continue;
          }
          let result = "default";
          switch (entity.role) {
            case "worker":
              result = worker.run(entity, jobs);
              if (result == "towerBuilt" || result == "spawnBuilt" || result == "deadCreep") {
                global.scheduler.stateUpdate++;
              }
              break;
            case "mobileHarvester":
              result = harvester.run(entity, jobs);
              if (result == "deadCreep") {
                global.scheduler.stateUpdate++;
              }
              break;
            case "hauler":
              result = hauler.run(entity, jobs);
              if (result == "deadCreep") {
                global.scheduler.stateUpdate++;
              }
              break;
            case "poke":
              result = combat.run(entity, jobs);
              if (result == "deadCreep") {
                global.scheduler.stateUpdate++;
              }
              break;
            case "drain":
              result = combat.run(entity, jobs);
              if (result == "deadCreep") {
                global.scheduler.stateUpdate++;
              }
              break;
            default:
              console.log("unknown creep role in states iterator:", JSON.stringify(entity));
          }
          break;
        case "spawn":
          let spawner = Game.getObjectById(entity.id) as StructureSpawn;
          if (spawner == null || entity.info.remove == true) {
            continue;
          }
          let energy = spawner.room.energyAvailable;
          let energyCap = spawner.room.energyCapacityAvailable;

          let workers = _.filter(states, entity => entity.type == "creep" && entity.role == "worker");
          let workerNum = workers.length;
          let creepCost = 200.0; //one move, one work, one carry
          if (
            workerNum < 4 &&
            !spawner.spawning &&
            energy >= 200 &&
            (workerNum < 2 || energy >= energyCap - (energyCap % creepCost))
          ) {
            let partList: BodyPartConstant[] = [];
            let partNum = energy / creepCost;
            let i = 1;
            while (i <= partNum) {
              partList.unshift(WORK);
              partList.push(CARRY);
              partList.push(MOVE);
              i++;
            }
            let creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-w";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
          }

          let mobileHarvesters = _.filter(states, entity => entity.type == "creep" && entity.role == "mobileHarvester");
          if (energy >= 550 && mobileHarvesters.length < 5) {
            let partList = [WORK, WORK, WORK, WORK, WORK, MOVE];
            let creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-mh";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
          }

          let haulers = _.filter(
            states,
            entity => entity.type == "creep" && (entity.role == "hauler")
          )
          creepCost = global.tools.BodyCost([CARRY,CARRY,MOVE])
          if(haulers.length<4 && energy>creepCost){
            let partList: BodyPartConstant[] = [];
            let partNum = energy / creepCost;
            let i = 1;
            while (i <= partNum && i < 8) {
              partList.unshift(CARRY);
              partList.unshift(CARRY);
              partList.push(MOVE);
              i++;
            }
            let creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-h";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
          }

          let combatants = _.filter(
            states,
            entity => entity.type == "creep" && (entity.role == "drain" || entity.role == "poke")
          );
          if (combatants.length < 1 && energy == energyCap) {
            console.log("make poke");
            let partList = [MOVE]; //[TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL]
            let creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-p";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
          }

          break;
        case "tower":
          entity = entity as TowerState;
          let gameUnit = Game.getObjectById(entity.id);
          if (!gameUnit) {
            console.log("broken tower id!!!");
            break;
          }

          if (entity.info.target) {
            let targetHostile = Game.getObjectById(entity.info.target);
            if (targetHostile) {
              gameUnit.attack(targetHostile);
              continue;
            } else {
              entity.info.target = undefined;
            }
          }

          let closestHostile = gameUnit.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
          if (
            closestHostile &&
            (global.map.maxDistance(closestHostile.pos, gameUnit.pos) < 10 ||
              closestHostile.owner.username == "Invader")
          ) {
            gameUnit.attack(closestHostile);
            entity.info.target = closestHostile.id;
          } else {
            let closestDamagedStructure = gameUnit.pos.findClosestByRange(FIND_STRUCTURES, {
              filter: structure =>
                structure.hits < structure.hitsMax / 4 &&
                structure.structureType != STRUCTURE_WALL &&
                structure.structureType != STRUCTURE_RAMPART
            });
            if (closestDamagedStructure) {
              gameUnit.repair(closestDamagedStructure);
            }
            break;
          }
          break;
        default:
          console.log("unknown entity in states iterator:", JSON.stringify(entity));
      }
    }
  }

  global.scheduler.endTick();

  if (Game.cpu.bucket == 10000) {
    Game.cpu.generatePixel();
  }
});

//remove dead units, add any new ones
//pass by ref, no need for return
function stateUpdate(states: StateEntity[]) {
  //remove dead states
  for (let i = 0; i < states.length; i++) {
    let testState = states[i];
    if (states[i].info.remove == true || (states[i].id && Game.getObjectById(states[i].id) == null)) {
      console.log("dead creep:", JSON.stringify(states[i]));
      if (states[i].type == "creep" && states[i]) {
        testState = testState as CreepState;
        switch (testState.role) {
          case "worker":
            worker.remove(testState, jobs);
            break;
          case "hauler":
            hauler.remove(testState, jobs);
            break;
          case "mobileHarvester":
            harvester.remove(testState, jobs);
            break;
          case "drainer":
            combat.remove(testState, jobs);
            break;

          default:
            break;
        }
      }

      states.splice(i, 1);
      i--;
    } //TODO: clean out jobs and suchlike OR assign id to new creep/building
  }

  for (let name in Game.creeps) {
    //check for new creeps
    let repeat = false;
    let creep = Game.creeps[name];
    for (let state of states) {
      if (state.type == "creep" && state.id == creep.id) {
        repeat = true;
        break;
      }
    }
    if (repeat) {
      continue;
    }
    let nameparts = name.split("-");
    let role = nameparts[nameparts.length - 1];
    switch (role) {
      case "w":
        role = "worker";
        break;
      case "mh":
        role = "mobileHarvester";
        break;
      case "h":
        role = "hauler";
        break;
      case "p":
        role = "poke";
        break;
      case "d":
        role = "drain";
        break;
      default:
        console.log("WHAT CREEP TYPE IS THIS *#^");
        break;
    }
    let cargo: ({[key: string]: number} | undefined) = undefined;
    if (creep.store.getCapacity() > 0) cargo = {};
    if(creep.store.getUsedCapacity()>0 && cargo){
      for (let id in creep.store) {
        cargo[id] = creep.store[id as ResourceConstant];
      }
    }
    states.push({
      type: "creep",
      id: creep.id,
      role: role,
      commands: [],
      info: {
        remove: false,
        workParts: creep.getActiveBodyparts(WORK),
        cargo: cargo,
        working: false,
        moving: false,
        pos: creep.pos
      }
    });
  }
  let towers: StructureTower[] = [];
  //check for new towers
  //first build list of towers
  for (let roomName in Game.rooms) {
    let roomTowers = Game.rooms[roomName].find(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType == STRUCTURE_TOWER
    }) as StructureTower[];
    towers = towers.concat(roomTowers);
  }
  for (let tower of towers) {
    let repeat = false;
    for (let state of states) {
      if (state.type == "tower" && state.id == tower.id) {
        repeat = true;
        break;
      }
    }
    if (repeat) {
      continue;
    }
    states.push({
      type: "tower",
      id: tower.id,
      info: {
        remove: false
      }
    });
  }
  for (let name in Game.spawns) {
    let repeat = false;
    let spawn = Game.spawns[name];
    for (let state of states) {
      if (state.type == "spawn" && state.id == spawn.id) {
        repeat = true;
        break;
      }
    }
    if (repeat) {
      continue;
    }
    states.push({
      type: "spawn",
      id: spawn.id,
      info: {
        remove: false
      }
    } as SpawnState);
  }
}
