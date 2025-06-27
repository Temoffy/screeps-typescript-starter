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
  return job.type != "delve";
}

function plan(creep: Creep, state: CreepState, jobList: Job[]) {
  if (creep.ticksToLive && creep.ticksToLive < 25) {
    creep.suicide();
    return false;
  }

  let plannedPos = creep.pos;
  let targetPos = plannedPos;
  let energy = creep.store[RESOURCE_ENERGY];
  if (energy < creep.store.getCapacity() / 3) {
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
        switch (creepState.commands[0].type) {
          case "deliver":
            task.deliver.resolve(creepState, jobList, false);
            break;
          case "carve":
            task.carve.resolve(creepState, jobList, false);
            break;
          case "refine":
            task.refine.resolve(creepState, jobList, false);
            break;
          case "earlymine":
            task.earlymine.resolve(creepState, jobList, false);
            break;
          case "restore":
            task.restore.resolve(creepState, jobList, false);
            break;
          case "delve":
            task.delve.resolve(creepState, jobList, false);
            break;
        }
      }
      return "deadCreep";
    }

    let resolveTask: boolean | undefined = true;
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

      resolveTask = undefined;
      switch (creepState.commands[0].type) {
        case "deliver":
          resolveTask = task.deliver.run(creep, creepState);
          break;
        case "carve":
          resolveTask = task.carve.run(creep, creepState);
          break;
        case "refine":
          resolveTask = task.refine.run(creep, creepState);
          break;
        case "earlymine":
          resolveTask = task.earlymine.run(creep, creepState);
          break;
        case "restore":
          resolveTask = task.restore.run(creep, creepState);
          break;
        case "delve":
          console.log("WORKER CLAIMED Static HARVEST JOB!!");
          break;
        default:
          console.log("unknown jobtype in creepstate:", JSON.stringify(creepState));
      }
      if (resolveTask != undefined) {
        resolveMessage = "testing"; //resolve(creepState, jobList, true);
        global.scheduler.jobUpdate++;
        global.scheduler.mapUpdate++;
        switch (creepState.commands[0].type) {
          case "deliver":
            task.deliver.resolve(creepState, jobList, resolveTask);
            break;
          case "carve":
            task.carve.resolve(creepState, jobList, resolveTask);
            break;
          case "refine":
            task.refine.resolve(creepState, jobList, resolveTask);
            break;
          case "earlymine":
            task.earlymine.resolve(creepState, jobList, resolveTask);
            break;
          case "restore":
            task.restore.resolve(creepState, jobList, resolveTask);
            break;
          case "delve":
            task.delve.resolve(creepState, jobList, resolveTask);
            break;
        }
      }
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      switch (creepState.commands[0].type) {
        case "deliver":
          task.deliver.resolve(creepState, jobs, false);
          break;
        case "carve":
          task.carve.resolve(creepState, jobs, false);
          break;
        case "refine":
          task.refine.resolve(creepState, jobs, false);
          break;
        case "earlymine":
          task.earlymine.resolve(creepState, jobs, false);
          break;
        case "restore":
          task.restore.resolve(creepState, jobs, false);
          break;
        case "delve":
          task.delve.resolve(creepState, jobs, false);
          break;
      }
      //resolve(creepState, jobs, false);
    }
  }
};

const hauler = {
  run(creepState: CreepState, jobList: Job[]) {
    return "";
  },
  remove(creepState: CreepState, jobs: Job[]) {

  }
};

export { worker, hauler };
