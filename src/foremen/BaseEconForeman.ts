/* eslint-disable @typescript-eslint/prefer-for-of */

// BaseEconForeman.ts

import { BaseForeman, Dwarf } from "./BaseForeman";
import { Tools } from "utils/Tools";
import { Evaluation, econTasks } from "econTasks";
import { Job, MY_NUMS } from "JobBoard";

interface ResourcePlan {
  visits: { roomName: string; id: Id<AnyStoreStructure>; amount: number }[];
  available: number;
  planUse: number;
  resourceType: ResourceConstant;
}
interface TaskMatrixCell {
  resourceType: ResourceConstant | undefined;
  evalu: Evaluation;
  plan: ResourcePlan | undefined;
}
interface TaskMatrixDwarfwise {
  dwarf: Dwarf;
  simStore: { store: SimpleStore; used: number };
  simPos: Pos;
  dwarfPossibleSources: { roomName: string; id: Id<AnyStoreStructure> }[];
  time: number;
}
interface TaskMatrixJobwise {
  job: Job;
  jobPossibleSources: { roomName: string; id: Id<AnyStoreStructure> }[];
}

abstract class BaseEconForeman extends BaseForeman {
  protected abstract jobs: Job[];

  // must be of shape [dwarfs][jobs], order matters!!
  // only semi-normalizes, mostly made to account for other dwarfs' priorities when deciding on job allocation.
  protected normalizeTaskMatrix(taskMatrix: Evaluation[][]) {
    // normalize, order matters!
    const skipNormalization = taskMatrix.length === 1;
    if (skipNormalization) {
      for (const task of taskMatrix[0]) {
        task.normalized = task.score;
      }
      return;
    }

    for (let j = 0; j < taskMatrix[0].length; j++) {
      const sum = _.sum(taskMatrix.map(row => row[j].score));
      if (sum === 0) {
        for (let i = 0; i < taskMatrix.length; i++) {
          taskMatrix[i][j].normalized = 0;
        }
        continue;
      }
      for (let i = 0; i < taskMatrix.length; i++) {
        taskMatrix[i][j].normalized = taskMatrix[i][j].score / sum;
      }
    }
    for (let i = 0; i < taskMatrix.length; i++) {
      const sum = _.sum(taskMatrix[i].map(cell => cell.normalized));
      if (sum === 0) {
        for (let j = 0; j < taskMatrix[0].length; j++) {
          taskMatrix[i][j].normalized = 0;
        }
        continue;
      }
      for (let j = 0; j < taskMatrix[0].length; j++) {
        taskMatrix[i][j].normalized = taskMatrix[i][j].normalized / sum;
      }
    }
  }
  protected findBestTaskCoords(taskMatrix: Evaluation[][]): { i: number; j: number } {
    const dwarfLength = taskMatrix.length;
    const jobLength = taskMatrix[0].length;
    if (dwarfLength === 0 || jobLength === 0) return { i: -1, j: -1 };
    let best = { i: -1, j: -1, score: 0 };
    for (let i = 0; i < dwarfLength; i++) {
      for (let j = 0; j < jobLength; j++) {
        if (taskMatrix[i][j].normalized > best.score) {
          best = { i, j, score: taskMatrix[i][j].normalized };
        }
      }
    }
    return { i: best.i, j: best.j };
  }
  protected findNearestContainers(
    pos: Pos,
    amount?: number,
    maxRank?: number,
    resourceType?: ResourceConstant
  ): { roomName: string; id: Id<AnyStoreStructure> }[] {
    // function draft courtesy of Claude ai.
    let results: { roomName: string; id: Id<AnyStoreStructure>; distance: number; stored: number }[] = [];

    const roomQueue: string[] = [pos.roomName];
    const checkedRooms = new Set<string>();

    while (roomQueue.length > 0) {
      const roomId = roomQueue.shift()!;
      if (checkedRooms.has(roomId)) continue;
      checkedRooms.add(roomId);

      const roomAtlas = g.atlas.rooms[roomId];
      if (!roomAtlas) continue;

      // find closest container in this room to check abort condition
      let closestInRoom = Infinity;
      for (const containerId in roomAtlas.containers) {
        const container = roomAtlas.containers[containerId as Id<AnyStoreStructure>];
        const dist = Tools.maxDistance(pos, container.pos);
        if (dist < closestInRoom) closestInRoom = dist;
      }

      // if results has anything, check abort condition
      if (results.length > 0) {
        const worstDistance = results[results.length - 1].distance;
        if (closestInRoom > worstDistance + 50) {
          // don't expand neighbors, but don't skip queue
          continue;
        }
      }

      for (const containerId in roomAtlas.containers) {
        const container = roomAtlas.containers[containerId as Id<AnyStoreStructure>];

        if (maxRank !== undefined && container.rank > maxRank) continue;

        let available: number;
        if (resourceType) {
          available = container.store[resourceType] || 0;
        } else {
          available = _.max(Object.values(container.store));
        }
        if (available <= 0) continue;

        const distance = Tools.maxDistance(pos, container.pos);

        results.push({ roomName: roomId, id: containerId as Id<AnyStoreStructure>, distance, stored: available });
      }
      results.sort((a, b) => a.distance - b.distance);
      results = results.slice(0, 5);

      if (amount && _.sum(results.map(r => r.stored)) >= amount && results.length >= 5)
        return results.map(({ roomName, id }) => ({ roomName, id }));

      for (const neighbor of roomAtlas.neighbors || []) {
        if (!checkedRooms.has(neighbor)) roomQueue.push(neighbor);
      }
    }

    return results.map(({ roomName, id }) => ({ roomName, id }));
  }
  protected findBestTaskForJob(
    job: Job,
    simDwarf: Dwarf,
    simStore: { store: SimpleStore; used: number },
    simPos: Pos,
    jobPossibleSources: { roomName: string; id: Id<AnyStoreStructure> }[],
    dwarfPossibleSources: { roomName: string; id: Id<AnyStoreStructure> }[]
  ): TaskMatrixCell {
    // important TODO: after testing the cpu efficiency of the current,
    // replace room search with searching the supplied container lists
    // expect that to do better
    let resourceType = job.resourceType;
    // if(resourceType === "any" && resourcePlan){
    //     resourceType = resourcePlan.resourceType;
    // }
    if (resourceType === "any") {
      for (const type in simStore.store) {
        if ((simStore.store[type as ResourceConstant] || 0) > (simStore.store[resourceType as ResourceConstant] || 0)) {
          resourceType = type as ResourceConstant;
        }
      }
    }

    let best = econTasks[job.type].efficiency(
      simDwarf,
      simStore.store,
      simPos,
      job,
      undefined,
      resourceType === "any" ? undefined : resourceType
    );

    if (job.type === "delve")
      return { resourceType: resourceType === "any" ? undefined : resourceType, evalu: best, plan: undefined };

    let rank = MY_NUMS.END_USER_RANK;
    if (job.type === "deliver") rank = job.rank;

    const availableCarry = simDwarf.info.carryParts * 50 - simStore.used - _.sum(Object.values(simStore.store));
    let resourcePlan: ResourcePlan | undefined; // = resourcePlanMatrix[matrixCoords.i][matrixCoords.j]

    // if already planned, or planned wrong resource, or plan fully used, or creep full; return original evaluation, don't mess with it.
    const idealAmount = Math.min(availableCarry, econTasks[job.type].maxResource(job));
    if (idealAmount <= 0)
      return { resourceType: resourceType === "any" ? undefined : resourceType, evalu: best, plan: undefined };

    let plan: ResourcePlan = {
      visits: [],
      available: 0,
      planUse: 0,
      resourceType: job.resourceType as ResourceConstant
    };
    const testedSources = new Set();
    for (const testSource of [...jobPossibleSources, ...dwarfPossibleSources]) {
      if (testedSources.has(testSource.id)) {
        continue;
      }
      testedSources.add(testSource.id);

      const container = g.atlas.rooms[testSource.roomName]?.containers[testSource.id];
      if (!container) continue;

      if (resourceType === "any") {
        let max = 0;
        let bestType: ResourceConstant | undefined;
        for (const type in container.store) {
          if ((container.store[type as ResourceConstant] || 0) > max) {
            max = container.store[type as ResourceConstant] || 0;
            bestType = type as ResourceConstant;
          }
        }
        if (!bestType) continue;
        resourceType = bestType;
      }

      if (!container.store[resourceType] || container.rank >= rank || !resourceType) {
        continue;
      }

      const actualAmount = Math.min(idealAmount, container.store[resourceType] || 0);
      const containerPos = container.pos;
      const timeAdjustment = Tools.maxDistance(simPos, containerPos);
      simStore.store[resourceType] = actualAmount + (simStore.store[resourceType] || 0);
      const test = econTasks[job.type].efficiency(
        simDwarf,
        simStore.store,
        containerPos,
        job,
        timeAdjustment,
        resourceType
      );
      simStore.store[resourceType]! -= actualAmount;

      if (test.score > best.score) {
        best = test;
        plan = {
          visits: [{ roomName: testSource.roomName, id: testSource.id, amount: actualAmount }],
          available: actualAmount,
          planUse: 0,
          resourceType
        };
      }
    }

    if (!resourcePlan) {
      resourcePlan = { visits: [], available: 0, planUse: 0, resourceType: plan.resourceType };
    }
    resourcePlan.visits.push(...plan.visits);
    resourcePlan.available += plan.available;
    return { resourceType: resourceType === "any" ? undefined : resourceType, evalu: best, plan: resourcePlan };
  }

  protected assignTasksByMatrix(jobAxis: Job[], dwarfAxis: Dwarf[]) {
    const cpuStart = Game.cpu.getUsed();
    const taskMatrix: TaskMatrixCell[][] = [];
    const tMatxJobwise: TaskMatrixJobwise[] = [];
    const tMatxDwarfwise: TaskMatrixDwarfwise[] = [];
    {
      // job axis info
      for (const i of jobAxis) {
        const amount = econTasks[i.type].maxResource(i);
        let rank: number | undefined;
        if ("rank" in i) {
          rank = i.rank;
        }
        let resourceType: ResourceConstant | undefined;
        if (i.resourceType !== "any") {
          resourceType = i.resourceType;
        }
        const jobPossibleSources = this.findNearestContainers(i.pos, amount, rank, resourceType);
        const jobRow = { job: i, jobPossibleSources };
        tMatxJobwise.push(jobRow);
      }

      // dwarf axis info
      for (const dwarf of dwarfAxis) {
        const creep = Game.getObjectById(dwarf.id);
        if (!creep) {
          dwarf.info.remove = true;
          console.log("creep not found for econ foreman task update (non-delve), removing dwarf");
          return;
        }
        const dwarfPossibleSources = this.findNearestContainers(creep.pos, dwarf.info.carryParts * CARRY_CAPACITY);

        const dwarfRow = {
          dwarf,
          dwarfPossibleSources,
          simPos: creep.pos,
          simStore: { store: dwarf.info.cargo, used: 0 },
          time: 0
        };
        tMatxDwarfwise.push(dwarfRow);
      }
    }

    for (const dWise of tMatxDwarfwise) {
      taskMatrix.push([]);
      for (const jWise of tMatxJobwise) {
        const cell = this.findBestTaskForJob(
          jWise.job,
          dWise.dwarf,
          dWise.simStore,
          dWise.simPos,
          jWise.jobPossibleSources,
          dWise.dwarfPossibleSources
        );
        taskMatrix[taskMatrix.length - 1].push(cell);
      }
    }

    const timeFactor = 50;
    // condition is just a check before starting the loop
    while (tMatxDwarfwise.length !== 0 && tMatxJobwise.length !== 0 && Game.cpu.bucket > 20) {
      this.normalizeTaskMatrix(taskMatrix.map(a => a.map(b => b.evalu)));
      for (let i = 0; i < taskMatrix.length; i++) {
        const adjustment = (timeFactor - tMatxDwarfwise[i].time) / timeFactor;
        for (let j = 0; j < taskMatrix[0].length; j++) {
          // apply time factor penalty to all tasks, so we pick the best one considering time.
          taskMatrix[i][j].evalu.normalized = taskMatrix[i][j].evalu.normalized * adjustment;
        }
      }

      // pick best task.
      const best = this.findBestTaskCoords(taskMatrix.map(a => a.map(b => b.evalu)));
      if (best.i === -1 || best.j === -1) break;

      const chosenDwarfRow = tMatxDwarfwise[best.i];
      const chosenJobRow = tMatxJobwise[best.j];
      tMatxDwarfwise[best.i].time += taskMatrix[best.i][best.j].evalu.time;
      // updated simstore AND simpos goes here!
      tMatxDwarfwise[best.i].simPos = chosenJobRow.job.pos;
      const resourcePlan = taskMatrix[best.i][best.j].plan;
      for (const visit of resourcePlan ? resourcePlan.visits : []) {
        const fakejob = {
          type: "deliver",
          target: visit.id,
          pos: g.atlas.rooms[visit.roomName].containers[visit.id].pos,
          amount: -visit.amount,
          resourceType: resourcePlan!.resourceType,
          priority: -1,
          rank: -1,
          tick: -1,
          active: -1,
          id: -1
        } as Job;
        econTasks.deliver.claim(
          chosenDwarfRow.dwarf,
          Game.getObjectById(chosenDwarfRow.dwarf.id)!,
          fakejob,
          -visit.amount,
          resourcePlan!.resourceType
        );
      }
      const resource = resourcePlan?.resourceType || taskMatrix[best.i][best.j].resourceType || RESOURCE_ENERGY;
      const claimedResourceAmount = econTasks[chosenJobRow.job.type].claim(
        chosenDwarfRow.dwarf,
        Game.getObjectById(chosenDwarfRow.dwarf.id)!,
        chosenJobRow.job,
        taskMatrix[best.i][best.j].evalu.amount,
        resource
      );
      if (resourcePlan) {
        tMatxDwarfwise[best.i].simStore.store[resource] =
          resourcePlan.available + (tMatxDwarfwise[best.i].simStore.store[resource] || 0);
      }
      tMatxDwarfwise[best.i].simStore.store[resource] = Math.max(
        (tMatxDwarfwise[best.i].simStore.store[resource] || 0) - claimedResourceAmount,
        0
      );
      // resourcePlan.planUse += taskMatrix[best.i][best.j].amount;
      tMatxDwarfwise[best.i].simStore.used += claimedResourceAmount;
      // resourcePlan.available -= taskMatrix[best.i][best.j].amount;

      // clean and recalculate
      if (tMatxDwarfwise[best.i].simStore.used >= tMatxDwarfwise[best.i].dwarf.info.carryParts * CARRY_CAPACITY) {
        tMatxDwarfwise.splice(best.i, 1);
        taskMatrix.splice(best.i, 1);
        best.i = -1;
      }
      if (tMatxJobwise[best.j].job.amount <= 0) {
        tMatxJobwise.splice(best.j, 1);
        taskMatrix.forEach(a => a.splice(best.j, 1));
        best.j = -1;
      }
      for (let i = 0; i < tMatxDwarfwise.length; i++) {
        for (let j = 0; j < tMatxJobwise.length; j++) {
          let recompute = false;
          for (const source of taskMatrix[i][j].plan?.visits || []) {
            if (
              (g.atlas.rooms[source.roomName]?.containers[source.id]?.store[
                taskMatrix[i][j].plan?.resourceType || RESOURCE_ENERGY
              ] || -1) <= source.amount
            ) {
              recompute = true;
              break;
            }
          }
          if (i === best.i || j === best.j) {
            recompute = true;
          }
          if (recompute) {
            taskMatrix[i][j] = this.findBestTaskForJob(
              tMatxJobwise[j].job,
              tMatxDwarfwise[i].dwarf,
              tMatxDwarfwise[i].simStore,
              tMatxDwarfwise[i].simPos,
              tMatxJobwise[j].jobPossibleSources,
              tMatxDwarfwise[i].dwarfPossibleSources
            );
          }
        }
      }
      if (tMatxDwarfwise.some(a => a.time < 10)) continue;
      break;
    }

    console.log(
      `cpu per creeps*jobs for ${this.name}: ${
        (Game.cpu.getUsed() - cpuStart) / (this.dwarves.length * this.jobs.length)
      }`
    );
    g.hud.addText("", `assign tasks for ${this.name} cpu: ${Game.cpu.getUsed() - cpuStart}`);
  }
}
export type { ResourcePlan, TaskMatrixCell, TaskMatrixDwarfwise, TaskMatrixJobwise };
export { BaseEconForeman };
