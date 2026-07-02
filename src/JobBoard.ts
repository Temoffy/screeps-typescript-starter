/*
Telos, ᏘᎼᏗ
7/30/23
screeps bot rewrite
reason: strings make good keys in js
also the current one has a seizure every couple minutes
*/

import { CtrlLvl, WorldAtlas } from "WorldAtlas";


type Job = DeliverJob | RefineJob | CarveJob | RestoreJob | DelveJob;

interface DeliverJob {
  readonly type: "deliver";
  readonly target: Id<AnyStoreStructure>;
  readonly pos: Pos;
  amount: number;
  readonly resourceType: ResourceConstant | "any";
  priority: number;
  rank: number;
  tick: number;
  active: number;
  readonly id: number;
}
interface RefineJob {
  readonly type: "refine";
  readonly target: Id<StructureController>;
  readonly pos: Pos;
  amount: number;
  readonly resourceType: RESOURCE_ENERGY;
  priority: number;
  tick: number;
  active: number;
  readonly id: number;
}
interface CarveJob {
  readonly type: "carve";
  readonly target: Id<ConstructionSite>;
  readonly pos: Pos;
  amount: number;
  readonly resourceType: RESOURCE_ENERGY;
  priority: number;
  tick: number;
  active: number;
  readonly id: number;
}
interface RestoreJob {
  readonly type: "restore";
  readonly target: Id<AnyStructure>;
  readonly pos: Pos;
  amount: number;
  readonly resourceType: RESOURCE_ENERGY;
  tick: number;
  priority: number;
  active: number;
  readonly id: number;
}
interface DelveJob {
  readonly type: "delve";
  readonly target: Id<Source> | Id<Mineral>;
  readonly pos: Pos;
  amount: number;
  readonly resourceType: ResourceConstant | "any";
  tick: number;
  priority: number;
  active: number;
  readonly id: number;
}

const enum MY_NUMS{
  UNSTABLE_SOURCE_RANK = 0,
  STABLE_SOURCE_RANK = 1,
  CENTRAL_BUFFER_RANK = 2,
  DISTRIBUTED_BUFFER_RANK = 3,
  END_USER_RANK = 4
};

class JobBoard {
  public GetNewId(jobs: Job[]): number {
    // min excluded algorithm
    let id = 0;
    const ids = new Set(jobs.map(j => j.id));
    while (ids.has(id)) {
      id++;
    }
    return id;
  }

  private JobsCleanup(jobs: Job[]): Job[] {
    const updatedjobs = jobs.filter(j => j.active > 0 || j.amount > 0);
    return updatedjobs;
  }

  private UpdateDelveJobs(jobs: Job[]): Job[] {
    const delveJobs = jobs.filter(j => j.type === "delve");
    for (const roomName in g.atlas.rooms) {
      const roomAtlas = g.atlas.rooms[roomName];
      // is mine check?
      if (roomAtlas.control < CtrlLvl.tentative) continue;

      for (const sourceId in roomAtlas.sources) {
        // is already a job check?
        if (delveJobs.some(j => j.target === sourceId)) {
          continue;
        }

        const sourceAtlas = roomAtlas.sources[sourceId as Id<Source>];
        const newJob: DelveJob = {
          type: "delve",
          target: sourceId as Id<Source>,
          pos: sourceAtlas.pos,
          amount: sourceAtlas.regenRate / HARVEST_POWER,
          resourceType: RESOURCE_ENERGY,
          tick: Game.time,
          priority: 1,
          active: 0,
          id: this.GetNewId(jobs)
        };
        jobs.push(newJob);
      }
      for (const mineralId in roomAtlas.minerals) {
        // is already a job check?
        if (delveJobs.some(j => j.target === mineralId)) {
          continue;
        }

        const mineralAtlas = roomAtlas.minerals[mineralId as Id<Mineral>];
        if (!mineralAtlas.harvestable) continue; // don't make jobs for unharvestable minerals, which can occur after depletion and before regen.
        const newJob: DelveJob = {
          type: "delve",
          target: mineralId as Id<Mineral>,
          pos: mineralAtlas.pos,
          amount: 50, // work as fast as possible
          resourceType: mineralAtlas.type,
          tick: Game.time,
          priority: 1,
          active: 0,
          id: this.GetNewId(jobs)
        };
        jobs.push(newJob);
      }
    }
    return jobs;
  }

  private UpdateCarveJobs(jobs: Job[]): Job[] {
    const carveJobs = jobs.filter(j => j.type === "carve");
    for (const roomName in g.atlas.rooms) {
      if (g.atlas.rooms[roomName].control < CtrlLvl.tentative) continue; // is mine check

      const carveSites = g.atlas.rooms[roomName].carveSites || {};
      jobs = jobs.filter(j => j.type !== "carve" || j.pos.roomName !== roomName || carveSites[j.target ]);

      for (const siteId in carveSites) {
        let priority = 2
        const realsite = Game.getObjectById(siteId as Id<ConstructionSite>);
        if (realsite) {
          priority += realsite.progress / realsite.progressTotal;
        }
        const job = carveJobs.find(j => j.target === siteId);
        if (job) {// already a job check
          job.priority = Math.max(priority, job.priority);
          continue;
        }
        const site = carveSites[siteId as Id<ConstructionSite>];
        const newJob: CarveJob = {
          type: "carve",
          target: siteId as Id<ConstructionSite>,
          pos: site.pos,
          amount: site.remaining,
          resourceType: RESOURCE_ENERGY,
          priority,
          active: 0,
          tick: Game.time,
          id: this.GetNewId(jobs)
        };
        // todo: maybe add/subtract some priority based on structure type?
        jobs.push(newJob);
      }
    }
    return jobs;
  }

  private UpdateRestoreJobs(jobs: Job[]): Job[] {
    const restoreJobs = jobs.filter(j => j.type === "restore");
    for (const roomName in g.atlas.rooms) {
      const roomAtlas = g.atlas.rooms[roomName];
      const room = Game.rooms[roomName]
      if (roomAtlas.control < CtrlLvl.tentative || !room) continue;

      // get all mine and neutral structures.
      const filter = (s: Structure) => s.hits < s.hitsMax;
      let structs = room.find(FIND_STRUCTURES, { filter });
      const enemyStructs = room.find(FIND_HOSTILE_STRUCTURES, { filter });
      const enemyIds = new Set<string>(enemyStructs.map(s => s.id));
      structs = structs.filter(s => !enemyIds.has(s.id));
      const structIds = new Set<string>(structs.map(s => s.id));

      // were any repaired or destroyed since last check?
      jobs = jobs.filter(j => j.pos.roomName !== roomName || j.type !== "restore" || structIds.has(j.target as string));

      // create jobs for those that need it, with wall handling
      // todo: make updateRoom function set goal to 60% of lowest wall in room?
      // ^ to detect and respond to damage.
      for (const struct of structs) {
        let priority = 1;
        const missingHits = struct.hitsMax - struct.hits;
        let percentMultiplier = missingHits / struct.hitsMax;
        if (missingHits < 2000 && percentMultiplier < 0.6) continue; // don't waste time on small repairs
        if (struct.structureType === STRUCTURE_WALL || struct.structureType === STRUCTURE_RAMPART) {
          const goal = roomAtlas.wallGoal || 500000;
          percentMultiplier = Math.max((goal - struct.hits) / goal, percentMultiplier*0.05);

          if (percentMultiplier < 0.05) continue;
        }
        priority = Math.max( 1 + 0.5*percentMultiplier, struct.hitsMax / (struct.hits*2));

        const job = restoreJobs.find(j => j.target === struct.id);
        if (job) {
          if (job.active > 0) continue
          job.amount = missingHits/REPAIR_POWER;
          job.priority = priority;
          continue;
        }

        const newJob: RestoreJob = {
          type: "restore",
          target: struct.id as Id<AnyStructure>,
          pos: { roomName: struct.pos.roomName, x: struct.pos.x, y: struct.pos.y },
          amount: missingHits,
          resourceType: RESOURCE_ENERGY,
          priority,
          active: 0,
          tick: Game.time,
          id: this.GetNewId(jobs)
        };
        jobs.push(newJob);
      }
    }
    return jobs;
  }

  private UpdateRefineJobs(jobs: Job[]): Job[] {
    const refineJobs = jobs.filter(j => j.type === "refine");
    const workpartDemand = 500;
    for (const roomName in g.atlas.rooms) {
      const roomAtlas = g.atlas.rooms[roomName];
      const room = Game.rooms[roomName];
      if (roomAtlas.control < CtrlLvl.colonized || !room || !room.controller) continue;
      const controller = room.controller;

      const priority = 1 + 50000 / controller.ticksToDowngrade

      const job = refineJobs.find(j => j.pos.roomName === roomName);
      if (job) {
        if (room.controller.level === 8 && job.amount > 20) {
          // might cause job to be deleted later if jobs are updated before creeps unclaim it? but it'll work out.
          job.amount -= (workpartDemand - 15)
          continue;
        }
        job.priority = 1 + 50000 / controller.ticksToDowngrade
        continue
      }

      const newJob: RefineJob = {
        type: "refine",
        target: controller.id ,
        pos: { roomName: controller.pos.roomName, x: controller.pos.x, y: controller.pos.y },
        amount: workpartDemand,
        resourceType: RESOURCE_ENERGY,
        priority,
        active: 0,
        tick: Game.time,
        id: this.GetNewId(jobs)
      };
      jobs.push(newJob);
    }
    return jobs;
  }

  public UpdateEconWorkPartJobs(jobs: Job[]): Job[] {
    let updatedJobs = this.JobsCleanup(jobs);

    updatedJobs = this.UpdateDelveJobs(updatedJobs);
    updatedJobs = this.UpdateCarveJobs(updatedJobs);
    updatedJobs = this.UpdateRestoreJobs(updatedJobs);
    updatedJobs = this.UpdateRefineJobs(updatedJobs);

    return updatedJobs;
  }

  // returns whether there is a corresponding job.
  private UpdateDeliverAmountIfJob(jobs: Job[], targetId: Id<AnyStoreStructure>, amount: number): boolean {
    const job = jobs.find(j => j.target === targetId && j.type === "deliver");
    if(!job) return false;
    if(job.active !== 0) return true;
    job.amount = amount;
    return true;
  }

  public UpdateEconCarryPartJobs(jobs: Job[]): Job[] {
    const updatedJobs = this.JobsCleanup(jobs);

    for (const roomName in g.atlas.rooms) {
      const roomAtlas = g.atlas.rooms[roomName];
      if (roomAtlas.control < CtrlLvl.colonized) continue;
      const room = Game.rooms[roomName];

      // highest priority tasks
      // extensions, spawns, and towers
      let types: string[] = [STRUCTURE_EXTENSION, STRUCTURE_SPAWN, STRUCTURE_TOWER];
      let targets = room.find(FIND_MY_STRUCTURES, {
        filter: s => types.some(t => t === s.structureType) && (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
      });
      for (const target of targets) {
        const isJob = this.UpdateDeliverAmountIfJob(updatedJobs, target.id as Id<AnyStoreStructure>, (target as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY));
        if (isJob) continue;

        const newJob: DeliverJob = {
          type: "deliver",
          target: target.id as Id<AnyStoreStructure>,
          pos: { roomName: target.pos.roomName, x: target.pos.x, y: target.pos.y },
          amount: (target as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY),
          resourceType: RESOURCE_ENERGY,
          priority: 2,
          active: 0,
          tick: Game.time,
          id: this.GetNewId(updatedJobs),
          rank: MY_NUMS.END_USER_RANK
        };
        updatedJobs.push(newJob);
      }

      // lower priority tasks
      // terminal, powerSpawn, factory
      types = [STRUCTURE_TERMINAL, STRUCTURE_POWER_SPAWN, STRUCTURE_FACTORY];
      targets = room.find(FIND_MY_STRUCTURES, {
        filter: s => types.some(t => t === s.structureType) && (s as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY) > 0
      });
      for (const target of targets) {
        let amount = (target as AnyStoreStructure).store.getFreeCapacity(RESOURCE_ENERGY);
        if (target.structureType === STRUCTURE_TERMINAL || target.structureType === STRUCTURE_FACTORY) {
          amount = Math.min(amount / 2, target.store.getFreeCapacity(RESOURCE_ENERGY) / 8);
        }
        const isJob = this.UpdateDeliverAmountIfJob(updatedJobs, target.id as Id<AnyStoreStructure>, amount);
        if (isJob) continue;

        const newJob: DeliverJob = {
          type: "deliver",
          target: target.id as Id<AnyStoreStructure>,
          pos: { roomName: target.pos.roomName, x: target.pos.x, y: target.pos.y },
          amount,
          resourceType: RESOURCE_ENERGY,
          priority: 1,
          active: 0,
          tick: Game.time,
          id: this.GetNewId(updatedJobs),
          rank: MY_NUMS.END_USER_RANK
        };
        updatedJobs.push(newJob);
      }

      // lowest priority tasks
      // fill containers
      for (const containerId in roomAtlas.containers) {
        const containerAtlas = roomAtlas.containers[containerId as Id<StructureContainer>];
        if(containerAtlas.rank <= MY_NUMS.STABLE_SOURCE_RANK || containerAtlas.max<=0) continue;

        let currentAmount = 0;
        for (const resource in containerAtlas.store) {
          currentAmount += containerAtlas.store[resource as ResourceConstant] || 0;
        }
        const amount = containerAtlas.max - currentAmount;

        // containers especially need to have their jobs updated
        // very big and long jobs
        const job = updatedJobs.find(j => j.target === containerId && j.type === "deliver");
        if(job && job.active === 0 && containerAtlas.active === 0){
          job.amount = amount;
          continue;
        }

        if(amount <= 0) continue;
        let material: ResourceConstant | 'any' = RESOURCE_ENERGY;
        if(containerAtlas.rank === MY_NUMS.CENTRAL_BUFFER_RANK){
          material = 'any';
        }

        const newJob: DeliverJob = {
          type: "deliver",
          target: containerId as Id<AnyStoreStructure>,
          pos: containerAtlas.pos,
          amount,
          resourceType: material,
          priority: 0.9,
          active: 0,
          tick: Game.time,
          id: this.GetNewId(updatedJobs),
          rank: containerAtlas.rank
        };
        updatedJobs.push(newJob);
      }
    }

    return updatedJobs;
  }
}

export type { Job }
export { JobBoard, MY_NUMS };
