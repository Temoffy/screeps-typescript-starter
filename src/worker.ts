import { SourceMap } from "module";

/*
task format for commandList is:
"type":jobType
"target":targetID,
"amount":amount //if applicable, not for build, upgrade, or harvest
"job":job object //if task linked to a job
*/
import jobBoard from "./jobBoard";

//return an array of job-style objects that fully fills a worker
//TODO: evaluate most time-effiecent actions to get energy
function getEnergy(creep: Creep, creepState: CreepState) {
  let map = global.map.rooms;
  let amount = creep.store.getFreeCapacity()

  let choiceId = undefined
  let choiceScore = 0
  let choiceRoom = undefined
  for(let roomId in map){
    let roomMem = map[roomId]
    for(let storeId in roomMem.containers){
      let storeMem = roomMem.containers[storeId]
      if(!storeMem.store[RESOURCE_ENERGY] || storeMem.store[RESOURCE_ENERGY] <= 0 || (storeMem.rank > 0 && storeMem.store[RESOURCE_ENERGY] < amount)) continue

      //verify object still around
      let store = Game.getObjectById(storeId)
      if(Game.rooms[roomId] && !store) {
        global.map.updateRoom(roomId)
        continue
      } else if(store && global.tools.HasStore(store) && store.store[RESOURCE_ENERGY] < storeMem.store[RESOURCE_ENERGY]) {
        storeMem.store[RESOURCE_ENERGY] = store.store[RESOURCE_ENERGY]
      } else if(store instanceof Resource && store.amount < storeMem.store[RESOURCE_ENERGY]){
        storeMem.store[RESOURCE_ENERGY] = store.amount
      }

      //score is energy/tick, assuming 2-way travel and 1 tile per tick movement
      let testScore = Math.min(storeMem.store[RESOURCE_ENERGY], amount) / (2 * global.map.maxDistance(creep.pos, storeMem.pos) + storeMem.rank)
      if(testScore<2) continue
      if(testScore>choiceScore){
        choiceScore = testScore
        choiceId = storeId
        choiceRoom = roomId
      }
    }
  }
  if(choiceId && choiceRoom){
    let containerMem = map[choiceRoom].containers[choiceId]
    amount = Math.min(amount, containerMem.store[RESOURCE_ENERGY]);
    creepState.commands.push({ type: "transfer", target: choiceId as Id<AnyStoreStructure|Tombstone|Ruin|Resource>, amount: -1 * amount });
    containerMem.store[RESOURCE_ENERGY] -= amount;
    containerMem.active++
    return containerMem.pos;
  }

  let choiceDist = 9999;
  let choiceSource: SourcesMem | null = null;
  for (let roomID in map) {
    if (map[roomID].enemyPresence == true) {
      continue;
    }
    for (let mapSource of map[roomID].sources) {
      let testDist = global.map.maxDistance(creep.pos, mapSource.pos);
      let actualSource = Game.getObjectById(mapSource.id);
      let actualE = 100;
      if (actualSource != null) {
        actualE = actualSource.energy;
      }
      if (testDist < choiceDist && mapSource.spaces > 0 && mapSource.workCap >= 2 && actualE > 0) {
        choiceSource = mapSource;
        choiceDist = testDist;
      }
    }
  }
  if (!choiceSource) {
    creep.say("❌⚡, 💔", true);
    return false;
  }


  creepState.commands.push({ type: "harvest", target: choiceSource.id, pos: choiceSource.pos, amount: amount, source: choiceSource });
  choiceSource.spaces--;
  choiceSource.workCap -= creepState.info.workParts;
  return choiceSource.pos;
}

function workerFilter(job: Job) {
  return job.type != "staticHarvest";
}

function plan(creep: Creep, state: CreepState, jobList: Job[]) {
  if (creep.ticksToLive && creep.ticksToLive < 25) {
    creep.suicide();
    return false;
  }

  let plannedPos = creep.pos;
  let targetPos = plannedPos
  let energy = creep.store[RESOURCE_ENERGY];
  if (energy < creep.store.getCapacity()/3) {
    let plannedPos = getEnergy(creep, state);
    if (!plannedPos) {
      return false;
    }
    return true;
  }
  while (energy > 0) {
    let myJob = jobBoard.getJob(jobList, workerFilter, creep.store.getCapacity(), plannedPos, targetPos);
    if (!myJob) {
      return false;
    }
    let eAmount;
    if (myJob.type == "repair") {
      eAmount = energy;
    } else {
      eAmount = Math.min(energy, myJob.amount);
    }
    let newCommand = {
      type: myJob.type,
      target: myJob.target as Id<AnyStoreStructure> /*jank todo*/,
      amount: eAmount,
      job: myJob.id
    };
    state.commands.push(newCommand);
    myJob.amount -= eAmount;
    myJob.active++;
    energy -= eAmount;

    if (myJob.target != null) {
      let targetEntityId = myJob.target as Id<AnyStructure>;
      let targetEntity = Game.getObjectById(targetEntityId);
      if (targetEntity) {
        targetPos = targetEntity.pos;
      }
    }
  }
  return true;
}

function resolve(state: CreepState, jobs: Job[], successful: boolean) {
  let command = state.commands[0];

  if (command.job != null) {
    let refJob = jobBoard.getJobFromID(jobs, command.job);
    if (!refJob) {
      console.log("cannot resolve" + JSON.stringify(state.commands[0]));
    } else {
      refJob.active--;
    }
  }
  let returnCode = "resolved";
  switch (command.type) {
    case "transfer":
      command = command as TransferJob
      if(!successful && command.pos){
        let containerMem = global.map.rooms[command.pos.roomName].containers[command.target]
        if(containerMem){
          if(command.amount<0) {
            containerMem.store[RESOURCE_ENERGY]+=command.amount
            containerMem.active--
          }
        }
      }
      break;
    case "construct":
      break;
    case "upgrade":
      break;
    case "harvest":
      let targetSource = global.map.getSourceFromID(command.target);
      if (!targetSource) {
        console.log("EMERGENCY! YOU SHOULD NEVER SEE THIS FROM worker.ts Resolve!!");
        return "allBroken";
      }
      targetSource.spaces++;
      targetSource.workCap += state.info.workParts;
  }
  if (command.job != null && !successful) {
    let job1 = jobBoard.getJobFromID(jobs, command.job) as Job;
    if (job1) {
      job1.amount += command.amount;
    }
  }

  state.commands.shift();
  return returnCode;
}

//negative value is from the thing to the creep
function transfer(creep: Creep, state: CreepState) {
  let target = Game.getObjectById(state.commands[0].target) as AnyCreep | AnyStoreStructure | Tombstone | Ruin;
  if(!target) return true //temp, todo account for rooms out of site
  let amount = state.commands[0].amount;
  if (amount < 0 && amount * -1 > target.store.getUsedCapacity(RESOURCE_ENERGY)) {
    amount = -1 * target.store.getUsedCapacity(RESOURCE_ENERGY);
    console.log("energy tracking failed under!! "+JSON.stringify(state.commands[0])+"  "+JSON.stringify(global.map.rooms[target.pos.roomName].containers[target.id]))
  }
  if (amount < 0 && amount * -1 > creep.store.getFreeCapacity()) {
    amount = creep.store.getFreeCapacity() * -1;
    console.log("energy tracking failed over!!! "+JSON.stringify(state.commands[0]+"  "+JSON.stringify(global.map.rooms[target.pos.roomName].containers[target.id])))
  }
  let result;
  if (amount > 0 && !(target instanceof Tombstone || target instanceof Ruin)) {
    if (creep.store[RESOURCE_ENERGY] == 0 || target.store.getFreeCapacity(RESOURCE_ENERGY) == 0) {
      return true;
    }
    result = creep.transfer(target, RESOURCE_ENERGY);
  } else if (!(target instanceof Creep || target instanceof PowerCreep)) {
    if (target.store[RESOURCE_ENERGY] == 0 || creep.store.getFreeCapacity(RESOURCE_ENERGY) == 0) {
      return true;
    }
    result = creep.withdraw(target, RESOURCE_ENERGY, -1 * amount); //todo unravel what happening
  }

  if (result == OK && state.info.cargo) {
    state.info.working = true
    state.info.cargo[RESOURCE_ENERGY]-=amount
    if(state.info.cargo[RESOURCE_ENERGY] < 0) console.log("Energy tracking failed! 2")
    let containerMem = global.map.rooms[creep.pos.roomName].containers[state.commands[0].target]
    if(containerMem){
      if(amount>0) global.map.containerAdd.push({roomId: target.pos.roomName, containerId: target.id as Id<AnyStoreStructure>, type: RESOURCE_ENERGY, amount: amount})
      else containerMem.active--
    }
    return true;
  }
  if (result == ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  }
  return false;
}

function construct(creep: Creep, state: CreepState) {
  let target = Game.getObjectById(state.commands[0].target);
  if (!(target instanceof ConstructionSite)) {
    return true;
  }
  let result = creep.build(target);
  if (result == ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  } else if (result == OK && creep.store[RESOURCE_ENERGY] <= creep.getActiveBodyparts(WORK) * 5) {
    return true;
  }
  if (creep.store[RESOURCE_ENERGY] == 0 || target == null) {
    return true;
  }
  return false;
}

function upgrade(creep: Creep, state: CreepState) {
  let target = Game.getObjectById(state.commands[0].target);
  if (!(target instanceof StructureController)) {
    console.log("upgrade function id error!");
    return true;
  }
  let result = creep.upgradeController(target);
  if (result == ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  } else if (result == OK && creep.store[RESOURCE_ENERGY] <= creep.getActiveBodyparts(WORK)) {
    return true;
  }
  if (creep.store[RESOURCE_ENERGY] == 0 || target.level == 8 || target == null) {
    return true;
  }
  return false;
}

//target is map source object, not game id
function harvest(creep: Creep, state: CreepState) {
  let target = Game.getObjectById(state.commands[0].target);
  if (!(target instanceof Source) || !state.commands[0].source) {
    console.log("harvest function id error! "+JSON.stringify(state.commands[0].pos));
    return true;
  }
  if (target == null) {
    creep.moveTo(state.commands[0].source.pos, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  }
  let result = creep.harvest(target);
  if (result == ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  } else if (result == OK && creep.store.getFreeCapacity() <= creep.getActiveBodyparts(WORK)) {
    return true;
  }
  if (creep.store[RESOURCE_ENERGY] == creep.store.getCapacity(RESOURCE_ENERGY) || target.energy == 0) {
    return true;
  }
  return false;
}

function repair(creep: Creep, state: CreepState) {
  let target = Game.getObjectById(state.commands[0].target) as AnyStructure;
  if (!target || target.hits == target.hitsMax) {
    target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: structure =>
        structure.hits < structure.hitsMax &&
        structure.structureType != STRUCTURE_WALL &&
        structure.structureType != STRUCTURE_RAMPART
    }) as AnyStructure;
    //todo find structures outside of current room
  }
  if (!target) {
    let targets = creep.room.find(FIND_STRUCTURES, {
      filter: structure =>
        structure.hits < structure.hitsMax &&
        (structure.structureType == STRUCTURE_WALL || structure.structureType == STRUCTURE_RAMPART)
    });
    let hits = 999;
    target = targets[0];
    for (let item of targets) {
      if (hits > item.hits) {
        hits = item.hits;
        target = item;
      }
    }
  }
  if (!target) {
    return true;
  }
  state.commands[0].target = target.id;

  let result = creep.repair(target);
  if (result == ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return false;
  }
  if (creep.store[RESOURCE_ENERGY] == 0) {
    return true;
  }
  return false;
}

const worker = {
  run(creepState: CreepState, jobList: Job[]) {
    let creep = Game.getObjectById(creepState.id);
    creepState.info.moving = false
    creepState.info.working = false

    if (creep == null || creepState.info.remove) {
      while (creepState.commands.length > 0) {
        resolve(creepState, jobList, false);
      }
      return "deadCreep";
    }

    let resolveTask = true;
    let resolveMessage = "working";
    let loop = 0;
    while (resolveTask && loop < 1) {
      //will loop forever getting energy from container then getting energy from container then...
      //current will cause problems for tracking energy amounts in mem
      loop++;
      if (creepState.commands.length == 0) {
        plan(creep, creepState, jobList);
      }
      if (creepState.commands.length == 0) {
        creep.say("❌🛠, 💔", true);
        return "noWork";
      }

      resolveTask = false;
      switch (creepState.commands[0].type) {
        case "transfer":
          if (transfer(creep, creepState)) {
            creep.say("➔✔️!", true);
            resolveTask = true;
          }
          break;
        case "construct":
          if (construct(creep, creepState)) {
            creep.say("🛠✔️!", true);
            resolveTask = true;
          }
          break;
        case "upgrade":
          if (upgrade(creep, creepState)) {
            creep.say("🔼✔️!", true);
            resolveTask = true;
          }
          break;
        case "harvest":
          if (harvest(creep, creepState)) {
            creep.say("⛏✔️!", true);
            resolveTask = true;
          }
          break;
        case "repair":
          if (repair(creep, creepState)) {
            creep.say("🛠🔼✔️!", true);
            resolveTask = true;
          }
          break;
        case "StaticHarvest":
          console.log("WORKER CLAIMED Static HARVEST JOB!!");
          break;
        default:
          console.log("unknown jobtype in creepstate:", JSON.stringify(creepState));
      }
      if (resolveTask) {
        resolveMessage = resolve(creepState, jobList, true);
      }
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      resolve(creepState, jobs, false);
    }
  }
};

export default worker;
