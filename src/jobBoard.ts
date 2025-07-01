/*
Telos, ᏘᎼᏗ
7/30/23
screeps bot rewrite
reason: strings make good keys in js
also the current one has a seizure every couple minutes
*/

import { repeat } from "lodash";
import { Position } from "source-map";

const MY_NUMS = {
  TRANSFER_PRIORITY: 500,
  CONSTRUCTION_PRIORITY: 100,
  UPGRADE_PRIORITY: 0,
  REPAIR_PRIORITY: 495,
  LT_HARVEST_PRIORITY: 400,
  UNSTABLE_SOURCE_RANK: 0,
  STABLE_SOURCE_RANK: 1,
  CENTRAL_BUFFER_RANK: 2,
  DISTRIBUTED_BUFFER_RANK: 3,
  END_USER_RANK: 4
};

function cleanList(jobs: Job[]) {
  for (let i = 0; i < jobs.length; i++) {
    if ((jobs[i].amount <= 0 && jobs[i].active <= 0) || !Game.getObjectById(jobs[i].target as Id<AnyStructure>)) {
      jobs.splice(i, 1);
      i = i - 1;
      continue;
    }
    let job = jobs[i];
    if (job.type == "restore") {
      job = job as RepairJob;
      for (let k = 0; k < job.target.length; k++) {
        let targetId = job.target[k];
        let target = Game.getObjectById(targetId) as AnyStructure | undefined;
        if (target && target.hitsMax * 0.9 < target.hits) {
          job.target.splice(Number(k), 1);
          k = k - 1;
        }
      }
      if (job.target.length == 0) {
        console.log("restore detected in cleanlist");
        jobs.splice(i, 1);
        i = i - 1;
        continue;
      }
    }
  }
}

function getTransferJobs(jobs: Job[]) {
  for (let i in Game.rooms) {
    let thisRoom = Game.rooms[i];
    if (thisRoom.controller == undefined || thisRoom.controller.my == false) {
      continue;
    }
    let targets: AnyStoreStructure[] = thisRoom.find(FIND_STRUCTURES, {
      filter: structure =>
        (structure.structureType == STRUCTURE_EXTENSION ||
          structure.structureType == STRUCTURE_SPAWN ||
          structure.structureType == STRUCTURE_TOWER) &&
        structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });
    for (let item of targets) {
      let repeat = false;
      for (let job of jobs) {
        if (item.id == job.target) {
          repeat = true;
          break;
        }
      }
      if (repeat) {
        continue;
      }
      let newJob: TransferJob = {
        type: "deliver",
        target: item.id,
        pos: item.pos,
        amount: item.store.getFreeCapacity(RESOURCE_ENERGY),
        resourceType: RESOURCE_ENERGY,
        rank: MY_NUMS.END_USER_RANK,
        priority: MY_NUMS.TRANSFER_PRIORITY,
        tick: Game.time,
        active: 0,
        id: getID(jobs)
      };
      jobs.push(newJob);
    }
  }
}

function getUpgradeJobs(jobs: Job[]) {
  for (let i in Game.rooms) {
    let thisRoom = Game.rooms[i];
    if (!thisRoom.controller || thisRoom.controller.my == false) {
      continue;
    }
    let item = thisRoom.controller;
    let repeat = false;
    for (let job of jobs as UpgradeJob[]) {
      if (item.id == job.target) {
        repeat = true;
        job.priority = MY_NUMS.UPGRADE_PRIORITY;
        job.amount = 15000000;
        if (job.priority < 0) {
          job.priority = 0;
        }
        break;
      }
    }
    if (repeat) {
      continue;
    }
    let amount = 15000000;
    let newJob = {
      type: "refine",
      target: item.id,
      pos: item.pos,
      amount: amount,
      priority: MY_NUMS.UPGRADE_PRIORITY,
      tick: Game.time,
      active: 0,
      id: getID(jobs)
    };
    jobs.push(newJob);
  }
}

function getConstructionJobs(jobs: Job[]) {
  for (let i in Game.rooms) {
    let thisRoom = Game.rooms[i];
    let targets = thisRoom.find(FIND_MY_CONSTRUCTION_SITES);
    for (let item of targets) {
      let repeat = false;
      for (let job of jobs) {
        if (item.id == job.target) {
          repeat = true;
          break;
        }
      }
      if (repeat) {
        continue;
      }
      let amount = 200;
      if (item.progressTotal) {
        amount = amount + item.progressTotal - item.progress;
      }
      let newJob = {
        type: "carve",
        target: item.id,
        pos: item.pos,
        amount: amount,
        priority: MY_NUMS.CONSTRUCTION_PRIORITY,
        active: 0,
        id: getID(jobs)
      };
      jobs.push(newJob);
    }
  }
}

function getRepairJobs(jobs: Job[]) {
  let priorRepairJobs = jobs.filter(entity => entity.type == "restore") as RepairJob[];
  let priorTargets: Id<AnyStructure>[] = [];
  for (let pJob of priorRepairJobs) {
    priorTargets.concat(pJob.target);
  }

  let jobamount = 0;
  let jobtargets = [];
  for (let i in Game.rooms) {
    let thisRoom = Game.rooms[i];
    let targets: AnyStructure[] = thisRoom.find(FIND_STRUCTURES, {
      filter: structure =>
        structure.hits < structure.hitsMax / 2 &&
        global.map.rooms[structure.room.name] &&
        !global.map.rooms[structure.room.name].enemyPresence &&
        ((structure.structureType != STRUCTURE_WALL && structure.structureType != STRUCTURE_RAMPART) ||
          structure.hits < 1000)
    });
    for (let item of targets) {
      if (priorTargets.includes(item.id)) {
        continue;
      }
      let newamount = item.hitsMax - item.hits;
      if (item instanceof StructureWall || item instanceof StructureRampart) newamount = 2000;
      jobamount = jobamount + newamount;
      jobtargets.push(item.id);
    }
  }
  if (jobtargets.length == 0) {
    return;
  }
  jobamount = Math.floor(jobamount / 100);
  let newJob = {
    type: "restore",
    target: jobtargets,
    pos: Game.getObjectById(jobtargets[0])!.pos,
    amount: jobamount,
    priority: MY_NUMS.REPAIR_PRIORITY,
    active: 0,
    id: getID(jobs)
  };
  jobs.push(newJob);
}

function getStaticHarvestJobs(jobs: Job[]) {
  let priorHarvestJobs = jobs.filter(entity => entity.type == "delve") as HarvestJob[];
  let map = global.map.rooms;
  for (let i in map) {
    let thisRoom = map[i];
    for (let source of thisRoom.sources) {
      if (source.container && !thisRoom.enemyPresence /*|| Game.rooms[i].controller?.owner?.username == "Temoffy"*/) {
        let repeat = false;
        for (let priorJob of priorHarvestJobs) {
          if (priorJob.target == source.id) {
            repeat = true;
            break;
          }
        }
        if (repeat) {
          continue;
        }
        let newJob = {
          type: "delve",
          target: source.id,
          pos: source.pos,
          amount: 5,
          tick: 0,
          priority: MY_NUMS.LT_HARVEST_PRIORITY,
          active: 0,
          id: getID(jobs)
        };
        jobs.push(newJob);
      }
    }
    for (let mineral of thisRoom.minerals ? thisRoom.minerals : []) {
      if (mineral.container && !thisRoom.enemyPresence) {
        let repeat = false;
        for (let priorJob of priorHarvestJobs) {
          if (priorJob.target == mineral.id) {
            repeat = true;
            break;
          }
        }
        if (repeat) {
          continue;
        }
        let workparts = 50;
        let newJob = {
          type: "delve",
          target: mineral.id,
          pos: mineral.pos,
          amount: workparts,
          tick: 0,
          priority: MY_NUMS.LT_HARVEST_PRIORITY,
          active: 0,
          id: getID(jobs)
        };
        jobs.push(newJob);
      }
    }
  }
}

function getID(jobs: Job[]) {
  let jobID = 0;
  let loop = true;
  while (loop) {
    loop = false;
    for (let job of jobs) {
      if (job.id == jobID) {
        jobID++;
        loop = true;
      }
    }
  }
  return jobID;
}

const jobBoard = {
  update(jobs: Job[]): void {
    cleanList(jobs);
    getTransferJobs(jobs);
    getConstructionJobs(jobs);
    getUpgradeJobs(jobs);
    getRepairJobs(jobs);
    getStaticHarvestJobs(jobs);
  },

  /*
  job list
  filter function that accepts job associative arrays/objects and returns if possible for the creep,
  maximum cargo creep can handle,
  roomposition object from which to weight distance in priority calc
  */
  getJob(
    jobs: Job[],
    jobFilter: (value: Job) => unknown,
    storage: { [key: string]: number },
    rankMin: number,
    workparts: number,
    origin1: RoomPosition,
    origin2: RoomPosition
  ) {
    let filteredJobs = jobs.filter(jobFilter);
    filteredJobs = filteredJobs.filter(job => job.amount >= 0);

    if (!filteredJobs.length || filteredJobs.length == 0) {
      return {job: undefined, score: 0};
    }

    let chosenJob: Job | undefined = undefined;
    let chosenPriority = -999999;
    for (let job of filteredJobs) {
      if(global.map.rooms[job.pos.roomName] && global.map.rooms[job.pos.roomName].enemyPresence) continue
      let distance = 0;
      let target;
      let priority = job.priority;
      switch (job.type) {
        case "restore":
          target = Game.getObjectById(job.target[0] as Id<AnyStructure>);
          let repairdistance = 999;
          for (let repairtarget of job.target) {
            let targettemp = Game.getObjectById(repairtarget as Id<AnyStructure>);
            if (
              targettemp &&
              global.map.maxDistance(targettemp.pos, origin1) + global.map.maxDistance(targettemp.pos, origin2) <
                repairdistance
            ) {
              repairdistance =
                global.map.maxDistance(targettemp.pos, origin1) + global.map.maxDistance(targettemp.pos, origin2);
              target = targettemp;
            }
          }
          break;
        case "delve":
          job = job as HarvestJob;
          if (job.active > 0) {
            continue;
          }
          if (job.amount != workparts && chosenPriority == -999999) {
            priority = -999900;
          }
          target = { pos: job.pos}//new RoomPosition(job.pos.x, job.pos.y, job.pos.roomName) };
          break
        case "deliver":
          if(!(storage[(job as TransferJob).resourceType] > 0) && (job as TransferJob).resourceType != 'any' ) continue
          if (rankMin > (job as TransferJob).rank) continue
          target = {pos: job.pos}
          break
        default:
          target = {pos: job.pos}//Game.getObjectById(job.target as Id<AnyStructure>);
          break;
      }
      if (target) {
        distance = global.map.maxDistance(target.pos, origin1) + global.map.maxDistance(target.pos, origin2);
      }
      let age = 0;
      priority = priority - distance * 0.1;

      if (priority > chosenPriority && job.amount > 0) {
        chosenPriority = priority;
        chosenJob = job;
      }
    }

    return {job:chosenJob, score:chosenPriority};
  },

  getJobFromID(jobs: Job[], id: number) {
    if (jobs == null) {
      console.log("jobs are null!");
      return false;
    }

    for (let job of jobs) {
      if (job.id == id) {
        return job;
      }
    }
    console.log("no job of given id");
    return undefined;
  }
};

export default jobBoard;
