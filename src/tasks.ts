import { min } from "lodash";
import jobBoard from "./jobBoard";
import { createUnzip } from "zlib";

function SourceClaim(targetMem:SourcesMem){

}

const task: any = {
  //todo dont use 'any'
  deliver: {
    run(hauler: Creep, state: CreepState) {
      let command = state.commands[0];
      let target = Game.getObjectById(command.target) as AnyCreep | AnyStoreStructure | Tombstone | Ruin | Resource;
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          hauler.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        console.log(command.type + " target not found! " + JSON.stringify(command));
        return false;
      }

      if (global.map.maxDistance(hauler.pos, command.pos) > 1 || command.pos.roomName != hauler.pos.roomName) {
        hauler.moveTo(target, { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working) return undefined;

      let result;
      let amount = command.amount;
      if (!command.resourceType) return false; //should never happen
      if (target instanceof Resource) result = hauler.pickup(target);
      else if (amount > 0)
        result = hauler.transfer(target as AnyCreep | AnyStoreStructure, command.resourceType, amount);
      else result = hauler.withdraw(target as Tombstone | Ruin | AnyStoreStructure, command.resourceType, -1 * amount);

      switch (result) {
        case OK:
          state.info.working = true;
          return true;
        case ERR_FULL:
          console.log("Energy tracking broke over " + JSON.stringify(command) + " " + JSON.stringify(target));
          return true; //lie to get transfer job to update, otherwise will keep failing
        //todo make jobs update better
        case ERR_NOT_ENOUGH_RESOURCES:
          console.log("Energy tracking broke under " + JSON.stringify(command) + " " + JSON.stringify(target));
          break;
        default:
          console.log("Unhandled error in deliver!" + JSON.stringify(command) + " " + result);
          break;
      }
      return true;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      let command = state.commands[0];
      if (!command.resourceType || !state.info.cargo) {
        console.log("deliver resolve error! No resourcetype or creep cargo!");
        state.commands.shift();
        return false;
      }

      //job
      if (command.job != null) {
        let refJob = jobBoard.getJobFromID(jobs, command.job);
        if (refJob) {
          refJob.active--;
          if (!successful) refJob.amount += command.amount;
        }
      }

      //creep info
      if (successful) {
        state.info.cargo[command.resourceType] = state.info.cargo[command.resourceType]? state.info.cargo[command.resourceType] - command.amount: -1*command.amount;
      } else if (!successful) {
        global.scheduler.stateUpdate++;
        global.scheduler.mapUpdate++;
      }

      //container info
      //EXPAND TO HANDLE CREEP-CREEP TRANSFERS!
      let containerMem = global.map.rooms[command.pos.roomName].containers[command.target];
      if (containerMem) {
        if (command.amount > 0) {
          if (successful)
            global.map.containerAdd.push({
              roomId: command.pos.roomName,
              containerId: command.target as Id<AnyStoreStructure>,
              type: command.resourceType,
              amount: command.amount
            });
        } else {
          containerMem.active--;
          if (!successful) {
            containerMem.store[RESOURCE_ENERGY] -= command.amount;
          }
        }
      }
      state.commands.shift();
      return true;
    }
  },
  carve: {
    run(mason: Creep, state: CreepState) {
      if (!state.info.cargo) {
        console.log("carve resolve error! No creep cargo!");
        return false;
      }

      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          mason.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        return true;
      }
      if (!(target instanceof ConstructionSite)) {
        console.log("can't build a not construction site!");
        return false;
      }

      if (global.map.maxDistance(mason.pos, command.pos) > 3 || command.pos.roomName != mason.pos.roomName) {
        mason.moveTo(target, { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = mason.build(target);

      switch (result) {
        case OK:
          state.info.working = true;
          command.amount -= state.info.workParts * 5;
          state.info.cargo[RESOURCE_ENERGY] -= state.info.workParts * 5;
          if (command.amount < 0) {
            //expect storage discrepancies to arise here
            //can't perfectly predict energy when multiple creeps complete a build
            state.info.cargo[RESOURCE_ENERGY] -= command.amount;
            return true;
          }
          return undefined;
        case ERR_NOT_ENOUGH_ENERGY:
          state.info.cargo.energy = 0;
          return true;
        default:
          console.log("Unhandled error in carving! " + JSON.stringify(command) + " " + result);
          break;
      }

      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      if (!state.info.cargo) {
        console.log("carve resolve error! No creep cargo!");
        return false;
      }

      let mason = Game.getObjectById(state.id);
      let command = state.commands[0];
      if (!state.info.cargo) console.log("carve resolve error! No resourcetype cargo!");
      if (!state.info.cargo || !mason) {
        state.commands.shift();
        return false;
      }

      //job
      if (command.job != null) {
        let refJob = jobBoard.getJobFromID(jobs, command.job);
        if (refJob) {
          refJob.active--;
          if (!successful) refJob.amount += command.amount;
        }
      }

      //creep
      state.info.cargo[RESOURCE_ENERGY] = mason.store.energy;

      state.commands.shift();
      return;
    }
  },
  refine: {
    run(smith: Creep, state: CreepState) {
      if (!state.info.cargo) {
        console.log("refine error! No creep cargo!");
        return false;
      }

      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          smith.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        console.log("somehow a controller has vanished??");
        return false;
      }
      if (!(target instanceof StructureController)) {
        console.log("can't refine a not controller!");
        return false;
      }

      if (global.map.maxDistance(smith.pos, command.pos) > 3 || command.pos.roomName != smith.pos.roomName) {
        smith.moveTo(target, { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = smith.upgradeController(target);

      switch (result) {
        case OK:
          state.info.working = true;
          command.amount -= state.info.workParts;
          state.info.cargo[RESOURCE_ENERGY] -= state.info.workParts;
          if (command.amount < 0) {
            //should NOT get discrepencies from upgrading
            //until rcl 8 maybe? todo see about swapping amount to be workparts instead of energy
            state.info.cargo[RESOURCE_ENERGY] -= command.amount;
            return true;
          }
          return undefined;
        case ERR_NOT_ENOUGH_ENERGY:
          state.info.cargo.energy = 0;
          return true;
        default:
          console.log("Unhandled error in refining! " + JSON.stringify(command) + " " + result);
          break;
      }

      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      //todo this does not properly resolve the job because the current upgrade job needs rebuilding
      let command = state.commands[0];
      if (command.job != null) {
        let refJob = jobBoard.getJobFromID(jobs, command.job);
        if (refJob) {
          refJob.active--;
        }
      }

      state.commands.shift();
      return;
    }
  },
  earlymine: {
    run(miner: Creep, state: CreepState) {
      if (miner.store.getFreeCapacity() == 0) {
        return true;
      }

      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          miner.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        return true;
      }
      if (!(target instanceof Source)) {
        console.log("can't earlymine a not source!");
        return false;
      }

      if (global.map.maxDistance(miner.pos, command.pos) > 1 || command.pos.roomName != miner.pos.roomName) {
        miner.moveTo(target, { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working || target.energy < 0) return undefined;

      let result = miner.harvest(target);

      switch (result) {
        case OK:
          state.info.working = true;
          //would cause storage discrepencies if it was tracked
          //namely when miner almost full or source almost empty
          return undefined;
        default:
          console.log("Unhandled error in earlymine! " + JSON.stringify(command) + " " + result);
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      if (!state.info.cargo) {
        console.log("refine error! No creep cargo!");
        return false;
      }

      let miner = Game.getObjectById(state.id);
      if (miner) state.info.cargo.energy = miner.store.energy;

      let targetSource = global.map.getSourceFromID(state.commands[0].target);
      if (targetSource) {
        targetSource.spaces++;
        targetSource.workCap += state.info.workParts;
      } else console.log("EMERGENCY! YOU SHOULD NEVER SEE THIS FROM earlyharvest resolve!!");

      state.commands.shift();
      return;
    }
  },
  delve: {
    run(delver: Creep, state: CreepState) {
      state.info.moving = false;
      state.info.working = false;
      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          delver.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        return true;
      }

      //TODO refactor map to group sources+minerals into 'veins'
      let veinMem;
      if (target instanceof Source) veinMem = global.map.getSourceFromID(target.id);
      else if (target instanceof Mineral) veinMem = global.map.getMineralFromID(target.id);
      else console.log("Unknow delve target!");

      if (!veinMem) {
        console.log("map broken in delve!");
        return false;
      }

      let pos = command.pos;
      let dist = 1;
      let containerMem;
      if (veinMem.container) containerMem = global.map.rooms[pos.roomName].containers[veinMem.container];
      if (containerMem) {
        pos = containerMem.pos;
        dist = 0;
      }

      if (global.map.maxDistance(delver.pos, pos) > dist || command.pos.roomName != delver.pos.roomName) {
        delver.moveTo(new RoomPosition(pos.x,pos.y,pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working) return undefined;

      let result;
      if (target instanceof Source) {
        if (target.energy > 0) result = delver.harvest(target);
        else return undefined
      } else if (target instanceof Mineral) {
        let extractor = target.pos.findInRange(FIND_STRUCTURES, 0, {
          filter: structure => structure.structureType == STRUCTURE_EXTRACTOR
        }) as StructureExtractor[];
        if (!extractor.length) return false;

        if (target.mineralAmount == 0 || extractor[0].cooldown != 0) return undefined;
        result = delver.harvest(target);
      } else {console.log("what delve target is "+JSON.stringify(target))}

      switch (result) {
        case OK:
          state.info.working = true;
          if (containerMem && veinMem.container) {
            let container = Game.getObjectById(veinMem.container)
            let resourceType;
            let multiplier = 0;
            let remaining = 0;
            if (target instanceof Source) {
              resourceType = RESOURCE_ENERGY;
              multiplier = 2;
              remaining = target.energy;
            } else if (target instanceof Mineral) {
              resourceType = target.mineralType;
              multiplier = 1;
              remaining = target.mineralAmount;
            } else console.log("unknown target kind in delve");

            if (resourceType){
              global.map.containerAdd.push({
                roomId: containerMem.pos.roomName,
                containerId: container?.id as Id<AnyStoreStructure>,
                type: resourceType,
                amount: Math.min(state.info.workParts * multiplier, remaining, container?.store.getFreeCapacity(resourceType)||0)
              });
            }
          }
          return undefined;
        default:
          console.log("Unhandled error in delve! " + JSON.stringify(command) + " " + result);
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      let command = state.commands[0];
      //job
      if (command.job) {
        let refJob = jobBoard.getJobFromID(jobs, command.job);
        if (refJob) {
          refJob.active--;
          if (!successful) refJob.amount += command.amount;
        }
      }

      let veinMem =
        global.map.getSourceFromID(state.commands[0].target) || global.map.getMineralFromID(state.commands[0].target);
      if (veinMem) {
        veinMem.spaces++;
        if ((veinMem as SourcesMem).workCap) (veinMem as SourcesMem).workCap += state.info.workParts;
      } else console.log("EMERGENCY! YOU SHOULD NEVER SEE THIS FROM delve resolve!!");

      state.commands.shift();
      return;
    }
  },
  restore: {
    run(custodian: Creep, state: CreepState) {
      if (custodian.store.energy == 0) {
        return true;
      }

      let command = state.commands[0];
      let target = Game.getObjectById(command.target) as AnyStructure;
      if (!target || target.hits == target.hitsMax) {
        if (!Game.rooms[command.pos.roomName]) {
          custodian.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName), { visualizePathStyle: { stroke: "#fcba03" } });
          return undefined;
        }
        let targetList = custodian.room.find(FIND_STRUCTURES, {
          filter: structure => structure.hits < structure.hitsMax * 0.8
        }) as AnyStructure[];
        if (!targetList.length) return true;

        let score = targetList[0].hits + 1000 * global.map.maxDistance(custodian.pos, targetList[0].pos);
        target = targetList[0];
        for (let item of targetList) {
          let testscore = item.hits + 15 * global.map.maxDistance(custodian.pos, item.pos);
          if (score > testscore) {
            score = testscore;
            target = item;
          }
        }

        command.target = target.id;
        command.pos = target.pos;
      }

      if (global.map.maxDistance(custodian.pos, command.pos) > 3 || command.pos.roomName != custodian.pos.roomName) {
        custodian.moveTo(target, { visualizePathStyle: { stroke: "#fcba03" } });
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = custodian.repair(target);

      switch (result) {
        case OK:
          state.info.working = true;
          return undefined;
        case ERR_NOT_ENOUGH_ENERGY:
          return true;
        default:
          console.log("Unhandled error in ! " + JSON.stringify(command) + " " + result);
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      let command = state.commands[0];
      //job
      if (command.job != null) {
        let refJob = jobBoard.getJobFromID(jobs, command.job);
        if (refJob) {
          refJob.active--;
          if (!successful) refJob.amount += command.amount;
        }
      }

      let custodian = Game.getObjectById(state.id) as Creep | undefined;
      if (state.info.cargo && custodian) state.info.cargo.energy = custodian.store.energy;
      state.commands.shift();
      return;
    }
  },
  establish: {
    run(h: Creep, state: CreepState) {
      //TODO THIS IS BOILERPLATE AND DOES NOT WORK
      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          h.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName));
          return undefined;
        }
        return true;
      }
      if (!(target instanceof ConstructionSite)) {
        console.log("can't build a not construction site!");
        return false;
      }

      if (global.map.maxDistance(h.pos, command.pos) > 99999999999999999999999999) {
        h.moveTo(target);
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = OK;

      switch (result) {
        case OK:

        default:
          console.log("Unhandled error in ! " + JSON.stringify(command));
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      state.commands.shift();
      return;
    }
  },
  noDwarfLeftBehind: {
    run(h: Creep, state: CreepState) {
      //TODO THIS IS BOILERPLATE AND DOES NOT WORK
      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          h.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName));
          return undefined;
        }
        return true;
      }
      if (!(target instanceof ConstructionSite)) {
        console.log("can't build a not construction site!");
        return false;
      }

      if (global.map.maxDistance(h.pos, command.pos) > 99999999999999999999999999) {
        h.moveTo(target);
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = OK;

      switch (result) {
        case OK:

        default:
          console.log("Unhandled error in ! " + JSON.stringify(command));
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      state.commands.shift();
      return;
    }
  },
  drink: {
    run(h: Creep, state: CreepState) {
      //TODO THIS IS BOILERPLATE AND DOES NOT WORK
      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          h.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName));
          return undefined;
        }
        return true;
      }
      if (!(target instanceof Object)) {
        console.log("can't build a not construction site!");
        return false;
      }

      if (global.map.maxDistance(h.pos, command.pos) > 99999999999999999999999999) {
        h.moveTo(target);
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = OK;

      switch (result) {
        case OK:

        default:
          console.log("Unhandled error in ! " + JSON.stringify(command));
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      state.commands.shift();
      return;
    }
  },
  stock: {
    run(h: Creep, state: CreepState) {
      //TODO THIS IS BOILERPLATE AND DOES NOT WORK
      let command = state.commands[0];
      let target = Game.getObjectById(command.target);
      if (!target) {
        if (!Game.rooms[command.pos.roomName]) {
          h.moveTo(new RoomPosition(command.pos.x,command.pos.y,command.pos.roomName));
          return undefined;
        }
        return true;
      }
      if (!(target instanceof Object)) {
        console.log("can't build a not construction site!");
        return false;
      }

      if (global.map.maxDistance(h.pos, command.pos) > 99999999999999999999999999) {
        h.moveTo(target);
        return undefined;
      }

      if (state.info.working) return undefined;

      let result = OK;

      switch (result) {
        case OK:

        default:
          console.log("Unhandled error in ! " + JSON.stringify(command));
          break;
      }
      return false;
    },
    resolve(state: CreepState, jobs: Job[], successful: boolean) {
      state.commands.shift();
      return;
    }
  }
};

export default task;
