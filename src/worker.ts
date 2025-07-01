import { SourceMap } from "module";

/*
task format for commandList is:
"type":jobType
"target":targetID,
"amount":amount //if applicable, not for build, upgrade, or harvest
"job":job object //if task linked to a job
*/
import jobBoard from "./jobBoard";
import task from "./tasks";
import { stat } from "fs";

//return an array of job-style objects that fully fills a worker
//TODO: evaluate most time-effiecent actions to get energy
function getEnergy(creep: Creep, creepState: CreepState) {
  let map = global.map.rooms;
  let amount = creep.store.getFreeCapacity();

  let body: BodyPartConstant[] = [];
  for (let part of creep.body) {
    body.push(part.type);
  }
  let creeptickcost = global.tools.BodyCost(body) / CREEP_LIFE_TIME;

  let choiceId = undefined;
  let choiceScore = 0;
  let choiceRoom = undefined;
  for (let roomId in map) {
    let roomMem = map[roomId];
    if(roomMem.enemyPresence) continue

    for (let storeId in roomMem.containers) {
      let storeMem = roomMem.containers[storeId];
      if (
        !storeMem.store[RESOURCE_ENERGY] ||
        storeMem.store[RESOURCE_ENERGY] <= 0 ||
        (storeMem.rank > 0 && storeMem.store[RESOURCE_ENERGY] < amount)
      )
        continue;

      //verify object still around
      let store = Game.getObjectById(storeId);
      if (Game.rooms[roomId] && !store) {
        global.map.updateRoom(roomId);
        continue;
      } else if (
        store &&
        global.tools.HasStore(store) &&
        store.store[RESOURCE_ENERGY] < storeMem.store[RESOURCE_ENERGY]
      ) {
        storeMem.store[RESOURCE_ENERGY] = store.store[RESOURCE_ENERGY];
      } else if (store instanceof Resource && store.amount < storeMem.store[RESOURCE_ENERGY]) {
        storeMem.store[RESOURCE_ENERGY] = store.amount;
      }

      //score is energy/tick, assuming 2-way travel and 1 tile per tick movement
      let testScore =
        Math.min(storeMem.store[RESOURCE_ENERGY], amount) /
        (2 * global.map.maxDistance(creep.pos, storeMem.pos) + storeMem.rank);
      if (testScore < 2 * creeptickcost) continue;
      if (testScore > choiceScore) {
        choiceScore = testScore;
        choiceId = storeId;
        choiceRoom = roomId;
      }
    }
  }
  if (choiceId && choiceRoom) {
    let containerMem = map[choiceRoom].containers[choiceId];
    amount = Math.min(amount, containerMem.store[RESOURCE_ENERGY]);
    creepState.commands.push({
      type: "deliver",
      target: choiceId as Id<AnyStoreStructure | Tombstone | Ruin | Resource>,
      pos: containerMem.pos,
      amount: -1 * amount,
      resourceType: RESOURCE_ENERGY
    });
    containerMem.store[RESOURCE_ENERGY] -= amount;
    containerMem.active++;
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

  creepState.commands.push({
    type: "earlymine",
    target: choiceSource.id,
    pos: choiceSource.pos,
    amount: amount,
    source: choiceSource
  });
  choiceSource.spaces--;
  choiceSource.workCap -= creepState.info.workParts;
  return choiceSource.pos;
}

function workerFilter(job: Job) {
  return job.type != "delve" && job.type != "deliver" ;
}

function plan(creep: Creep, state: CreepState, jobList: Job[]) {
  if (creep.ticksToLive && creep.ticksToLive < 25) {
    creep.suicide();
    return false;
  }

  if(!state.info.cargo) {
    console.log("broken worker! no cargo")
    return false
  }

  let plannedPos = creep.pos;
  let targetPos = plannedPos;
  let energy = state.info.cargo[RESOURCE_ENERGY]||0;
  if (energy < creep.store.getCapacity() / 3) {
    let plannedPos = getEnergy(creep, state);
    if (!plannedPos) {
      return false;
    }
    return true;
  }
  while (energy > 0) {
    let {job:myJob, score:discard} = jobBoard.getJob(jobList, workerFilter,state.info.cargo||{}, creep.store.getCapacity(), 4, plannedPos, targetPos);
    if (!myJob) {
      return false;
    }
    let eAmount;
    if (myJob.type == "restore") {
      eAmount = energy;
    } else {
      eAmount = Math.min(energy, myJob.amount);
    }
    let newCommand: Command = {
      type: myJob.type,
      target: myJob.target as Id<AnyStoreStructure> /*jank todo*/,
      pos: myJob.pos,
      amount: eAmount,
      resourceType: RESOURCE_ENERGY,
      job: myJob.id
    };
    state.commands.push(newCommand);
    myJob.amount -= eAmount;
    myJob.active++;
    energy -= eAmount;

    targetPos = myJob.pos;
  }
  return true;
}

const worker = {
  run(creepState: CreepState, jobList: Job[]) {
    let creep = Game.getObjectById(creepState.id);
    creepState.info.moving = false;
    creepState.info.working = false;

    if (creep == null || creepState.info.remove) {
      while (creepState.commands.length > 0) {
        let command = creepState.commands[0];
        if (task[command.type]) task[command.type].resolve(creepState, jobList, false);
        else console.log("unknown task type 1");
      }
      return "deadCreep";
    }

    let resolveTask: boolean | undefined = true;
    let resolveMessage = "working";
    let loop = 0;
    while (resolveTask && loop < 4) {
      //will loop forever getting energy from container then getting energy from container then...
      //current will cause problems for tracking energy amounts in mem
      loop++;
      if (creepState.commands.length == 0) {
        plan(creep, creepState, jobList);
      }
      if (creepState.commands.length == 0) {
        creep.say("❌🛠, 💔. "+loop, true);
        return "noWork";
      }

      resolveTask = undefined;
      let command = creepState.commands[0];
      if (task[command.type]) resolveTask = task[command.type].run(creep, creepState);
      else console.log("unknown task type 2");
      if (resolveTask != undefined) {
        resolveMessage = "testing"; //resolve(creepState, jobList, true);
        global.scheduler.jobUpdate++;
        global.scheduler.mapUpdate++;
        if (task[command.type]) resolveTask = task[command.type].resolve(creepState, jobList, resolveTask);
        else console.log("unknown task type 3");
      }
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      let command = creepState.commands[0]
      if (task[command.type]) task[command.type].resolve(creepState, jobs, false);
      else console.log("unknown task type 4")
    }
  }
};

export default worker;
