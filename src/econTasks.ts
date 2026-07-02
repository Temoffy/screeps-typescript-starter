/* eslint-disable max-classes-per-file */
import { min } from "lodash";
import { type Job } from "./JobBoard";
import { Tools } from "utils/Tools";
import { CtrlLvl} from "WorldAtlas";
import { Command, Dwarf } from "foremen/BaseForeman";


interface Evaluation {
  normalized: number;
  score: number;
  amount: number;
  time: number;
}

abstract class Task {
  // return energy/intent estimate for this task
  // todo: account for energy loss from creep aging (don't allocate big creeps to small jobs)
  // be careful, don't touch simdwarf.info.cargo!
  public abstract efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: Pos, job: Job, timeAdjustment?: number): Evaluation;
  // operate on job and dwarf to create the next command(s) and store in dwarf. Return used resource count
  public abstract claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number, resourceType?: ResourceConstant): number;
  // returns boolean if task is complete, undefined if still in progress
  public abstract do(dwarf: Dwarf, creep: Creep): boolean | undefined;
  // updates job and dwarf on task completion, return if jobs needs updating
  // success is whether to revert the job or complete it, errors in do() may be counted as successes here to clear away broken jobs.
  public abstract complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean;
  // simple function to differentiate between continuous tasks and limited tasks, used for task claiming logic
  public abstract maxResource(job: Job): number;

  protected travel(creep: Creep, targetId: Id<RoomObject&_HasId>, targetPos: Pos, range: number): boolean | undefined {
    const target = Game.getObjectById(targetId);
    let travelPos
    if (!target) {
      // if I have sight of the room but not the target, then the target must be gone
      if (Game.rooms[targetPos.roomName]) return false;
      travelPos = new RoomPosition(targetPos.x, targetPos.y, targetPos.roomName);
    } else {
      travelPos = target.pos;
      if (creep.pos.inRangeTo(travelPos, range)) return true;
    }

    const result = creep.moveTo(travelPos, { range });
    if (result === OK || result === ERR_TIRED) return undefined;

    console.log(`Error moving creep ${creep.name} to ${JSON.stringify(travelPos)}: ${result}`);
    return undefined;
  }

  protected unclaimJob(jobs: Job[], jobId: number | undefined, returnAmount: number): boolean {
    if(jobId === -1) return true
    if (!jobId) return false;
    const job = jobs.find(j => j.id === jobId);
    if (!job) return false;
    job.active--;
    job.amount += returnAmount;
    return true;
  }

  protected generateBasicCommand(job: Job, amount: number, resourceType?: ResourceConstant): Command {
    const newCommand: Command = {
      type: job.type,
      target: job.target as Id<AnyStructure>,
      pos: job.pos,
      amount,
      resourceType: resourceType || RESOURCE_ENERGY,
      jobId: job.id
    };
    job.amount -= amount;
    job.active++;
    job.tick = Game.time

    return newCommand
  }

  protected continuousTaskMaxResource(): number {return 100000}
  protected limitedTaskMaxResource(job: Job): number {
    return job.amount;
  }
}

class DeliverTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: Pos, job: Job, timeAdjustment=0, resourceType?: ResourceConstant): Evaluation {
    const result: Evaluation = { normalized: 0, score: 0, amount: 0, time: 0 };
    if (job.resourceType === "any" && !resourceType) {
      console.log("efficiency deliver task error: job resource type is any but no resource type provided");
      return result;
    }

    let maxAmount
    if (job.amount > 0) {
      maxAmount = simStore[resourceType || job.resourceType as ResourceConstant] || 0;
    } else {
      let usedAmount = 0;
      for (const resource in simStore) {
        usedAmount = usedAmount + (simStore[resource as ResourceConstant] || 0);
      }
      maxAmount = simDwarf.info.carryParts * CARRY_CAPACITY - usedAmount;
    }
    const amount = Math.min(maxAmount, Math.abs(job.amount));

    // todo: pathfinding length. v low priority
    const distance = 1.1*Tools.maxDistance(simPos, job.pos) + 1.1*timeAdjustment;

    // amount*lifetime / spawncost*distance
    // priority should be a number between ~0 and ~2, default 1.
    const score = job.priority * (amount*1500) / (simDwarf.info.spawnCost*(distance+.1)); // +.1 avoids div/0 err

    return { normalized: 0, score, amount, time: distance };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number, resourceType?: ResourceConstant): number {
    if (job.resourceType === "any" && !resourceType) {
      console.log("claiming haul task error: job resource type is any but no resource type provided");
      return 0;
    }
    if (amount < 0 && (creep.store.getFreeCapacity() < amount * -1)) {
      console.log("deliver error1" + JSON.stringify(creep.store) + JSON.stringify(job))
      return 0;
    }
    const containerTally = g.atlas.rooms[job.pos.roomName].containers[job.target as Id<StructureContainer>];
    if (containerTally) {
      if (amount < 0) {
        containerTally.active++;
        containerTally.store[resourceType as ResourceConstant] = (containerTally.store[resourceType as ResourceConstant] || 0) + amount;
      }
    }
    const command = this.generateBasicCommand(job, amount, resourceType || job.resourceType as ResourceConstant);

    dwarf.commands.push(command);
    return amount;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    const command = dwarf.commands[0];
    if (!command) {
      console.log("no command for haul task??");
      return false;
    }

    const traveling = this.travel(creep, command.target, command.pos, 1);
    if (traveling !== true) return traveling;

    // already did action this tick?
    if (dwarf.info.working) return undefined;

    const target = Game.getObjectById(command.target);
    const amount = command.amount;
    if (!command.resourceType) return false; // to silence typescript, should always be set for haul tasks

    let result;
    if (target instanceof Resource) result = creep.pickup(target);
    else if (amount > 0)
      result = creep.transfer(target as AnyCreep | AnyStoreStructure, command.resourceType, amount);
    else result = creep.withdraw(target as Tombstone | Ruin | AnyStoreStructure, command.resourceType, -1 * amount);

    switch (result) {
      case OK:
        dwarf.info.working = true;
        return true;
      case ERR_FULL:
        // TODO: fail loud to check for errors in energy tracking, currently silenced because of spawn regeneration edge case
        break;
      default:
        console.log("Unhandled error in deliver!" + JSON.stringify(command) + " " + result.toString());
        break;
    }
    // complete the job, if it still needs doing it will be detected and readded
    return true;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command || !command.resourceType || !dwarf.info.cargo) {
      console.log("deliver complete typescript error");
      return false;
    }

    if (success) {
      const carrying = dwarf.info.cargo[command.resourceType] || 0;
      dwarf.info.cargo[command.resourceType] = carrying - command.amount;
    }

    const containerTally = g.atlas.rooms[command.pos.roomName].containers[command.target as Id<StructureContainer>];
    if (containerTally) {
      if (command.amount > 0 && success) {
        g.atlas.LogContainerAdd({ roomId: command.pos.roomName, containerId: command.target as Id<StructureContainer>, amount: command.amount, type: command.resourceType })
      } else {
        containerTally.active--;
        if (!success) {
          containerTally.store[command.resourceType] = (containerTally.store[command.resourceType] || command.amount) - command.amount;
        }
      }
    }
    let returnAmount = 0
    if (!success) returnAmount = command.amount
    return this.unclaimJob(jobs, command.jobId, returnAmount);
  }
  public maxResource(job: Job): number {
    return this.limitedTaskMaxResource(job);
  }
}

// build construction site
class CarveTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: Pos, job: Job, timeAdjustment = 0): Evaluation {
    const maxAmount = simStore[RESOURCE_ENERGY] || 0;
    if (maxAmount <= 0 || job.amount <= 0) {
      return { normalized: 0, score: 0, amount: 0, time: 0 };
    }

    const amount = Math.min(maxAmount, job.amount);

    // todo: pathfinding length. v low priority
    const distance = Tools.maxDistance(simPos, job.pos);
    const time = 1.1*distance + 1.1*timeAdjustment + Math.ceil(amount / (simDwarf.info.workParts * BUILD_POWER))

    // amount*lifetime / spawncost*distance
    // priority should be a number between ~0 and ~2, default 1.
    const score = job.priority * (amount*1500) / (simDwarf.info.spawnCost*(time+.1)); // +.1 avoids div/0 err

    return { normalized: 0, score, amount, time };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number): number {
    if (amount < 0) {
      console.log("claiming carve task error: amount must be positive");
      return 0;
    }

    const command = this.generateBasicCommand(job, amount);
    dwarf.commands.push(command);
    return amount;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    // impossible, but to silence typescript.
    if (!dwarf.info.cargo || dwarf.info.cargo[RESOURCE_ENERGY] === undefined) {
      console.log("carve cargo error");
      return false;
    }

    const command = dwarf.commands[0];
    if (!command) {
      console.log("no command for carve task??");
      return false;
    }

    const traveling = this.travel(creep, command.target, command.pos, 1);
    if (traveling === undefined) return undefined;
    // construction might be complete, but it's certainly gone!
    if (traveling === false) return true;

    if (dwarf.info.working) return undefined;

    const target = Game.getObjectById(command.target);
    const result = creep.build(target as ConstructionSite);
    switch (result) {
      case OK:
        dwarf.info.working = true;
        // use current work parts to account for damage
        // eslint-disable-next-line no-case-declarations
        const carveAmount = creep.getActiveBodyparts(WORK) * BUILD_POWER;
        command.amount -= carveAmount;
        dwarf.info.cargo.energy -= carveAmount;
        if (command.amount <= 0) {
          dwarf.info.cargo.energy += -1 * command.amount; // refund excess energy
          return true;
        }
        return undefined;
      case ERR_NOT_ENOUGH_ENERGY:
        dwarf.info.cargo.energy = 0
        console.log("carve error: not enough energy");
        break;
      default:
        console.log(`Unhandled error in carve! ${JSON.stringify(command)} ${result}`);
        break;
    }
    return false;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command) {
      console.log("carve complete typescript error");
      return false;
    }

    let returnAmount = 0
    if (!success) returnAmount = command.amount
    return this.unclaimJob(jobs, command.jobId, returnAmount);
  }

  public maxResource(job: Job): number {
    return this.limitedTaskMaxResource(job);
  }
}

// upgrade controller
class RefineTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: Pos, job: Job, timeAdjustment = 0): Evaluation {
    const maxAmount = simStore[RESOURCE_ENERGY] || 0;
    if (maxAmount <= 0 || job.amount <= 0) {
      return { normalized: 0, score: 0, amount: 0, time: 0 };
    }

    // todo: pathfinding length. v low priority
    const distance = Tools.maxDistance(simPos, job.pos);
    const workAmount = Math.min(simDwarf.info.workParts, job.amount);
    const time = 1.1*distance + Math.ceil(maxAmount / (workAmount * UPGRADE_CONTROLLER_POWER)) + 1.1*timeAdjustment;

    // amount*lifetime / spawncost*distance
    // priority should be a number between ~0 and ~2, default 1.
    let score = job.priority * (maxAmount*1500) / (simDwarf.info.spawnCost*(time+.1)); // +.1 avoids div/0 err
    score /= Math.pow(2, job.active)

    return { normalized: 0, score, amount: workAmount, time };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number): number {
    if (amount < 0) {
      console.log("claiming refine task error: amount must be positive");
      return 0;
    }

    const command = this.generateBasicCommand(job, amount);
    dwarf.commands.push(command);
    return 9999999;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    // impossible, but to silence typescript.
    if (!dwarf.info.cargo || dwarf.info.cargo[RESOURCE_ENERGY] === undefined) {
      console.log("refine cargo error");
      return false;
    }

    const command = dwarf.commands[0];
    if (!command) {
      console.log("no command for refine task??");
      return false;
    }

    const traveling = this.travel(creep, command.target, command.pos, 3);
    if (traveling !== true) return traveling;

    if (dwarf.info.working) return undefined;

    const target = Game.getObjectById(command.target);
    const result = creep.upgradeController(target as StructureController);
    switch (result) {
      case OK:
        dwarf.info.working = true;
        // use current work parts to account for downgrades
        // eslint-disable-next-line no-case-declarations
        const refineAmount = Math.min(creep.getActiveBodyparts(WORK), dwarf.info.cargo.energy, creep.store.energy);
        dwarf.info.cargo.energy -= refineAmount;
        if (refineAmount < creep.getActiveBodyparts(WORK)) {
          dwarf.info.cargo.energy = 0;
          return true;
        }
        return undefined;
      case ERR_NOT_ENOUGH_ENERGY:
        dwarf.info.cargo.energy = 0
        console.log("refine error: not enough energy");
        break;
      default:
        console.log(`Unhandled error in refine! ${JSON.stringify(command)} ${result}`);
        break;
    }
    return false;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command) {
      console.log("refine complete typescript error");
      return false;
    }

    const returnAmount = dwarf.info.workParts
    return this.unclaimJob(jobs, command.jobId, returnAmount);
  }

  public maxResource(job: Job): number {
    return this.continuousTaskMaxResource();
  }
}

// claim new controller
class ColonizeTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: RoomPosition, job: Job, timeAdjustment = 0): Evaluation {
    const amount = Math.min(1,job.amount); // colonize tasks are all or nothing, so amount is always 1
    const distance = 1.1 * Tools.maxDistance(simPos, job.pos) + 1.1 * timeAdjustment;
    const score = job.priority * amount / (simDwarf.info.spawnCost*(distance+.1)); // +.1 avoids div/0 err
    return { normalized: 0, score, amount, time: distance };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number): number {
    if (amount < 0) {
      console.log("claiming colonize task error: amount must be positive");
      return 0;
    }

    const command = this.generateBasicCommand(job, amount);
    dwarf.commands.push(command);
    return 0;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    const command = dwarf.commands[0];
    if (!command) {
      console.log("no command for colonize task??");
      return false;
    }

    const traveling = this.travel(creep, command.target, command.pos, 1);
    if (traveling !== true) return traveling;

    if (dwarf.info.working) return undefined;

    const target = Game.getObjectById(command.target);
    const result = creep.claimController(target as StructureController);
    switch (result) {
      case OK:
        dwarf.info.working = true;
        // claiming may take multiple ticks(?), so wait to complete until it's done
        return undefined;
      case ERR_GCL_NOT_ENOUGH:
        console.log("colonize error: not enough GCL");
        break
    }
    // TODO: check whether claiming really is instant.
    if (creep.room.controller?.my) {
      return true;
    }
    return false;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command) {
      console.log("colonize complete typescript error");
      return false;
    }

    if (success) {
      g.atlas.rooms[command.pos.roomName].control = CtrlLvl.colonized;
    }

    let returnAmount = 0
    if (!success) returnAmount = command.amount
    return this.unclaimJob(jobs, command.jobId, returnAmount);
  }
  public maxResource(job: Job): number {
    return this.limitedTaskMaxResource(job);
  }
}

// mine source or mineral
class DelveTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: RoomPosition, job: Job, timeAdjustment = 0): Evaluation {
    // delve tasks are by workpart, not energy.
    // job.active is workpart count, not creep count
    if (job.amount <= job.active) return { normalized: 0, score: 0, amount: 0, time: 0 };
    if (job.resourceType !== RESOURCE_ENERGY && job.active >0) return { normalized: 0, score: 0, amount: 0, time: 0 }; // only one creep on minerals

    const amount = Math.max( 0, Math.min( simDwarf.info.workParts, job.amount - job.active));
    const distance = 1.1 * Tools.maxDistance(simPos, job.pos) + 1.1 * timeAdjustment;
    const score = job.priority * Math.pow(amount, 3) / (simDwarf.info.spawnCost*(distance+10)); // +.1 avoids div/0 err
    return { normalized: 0, score, amount, time: distance + 500 };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number): number {
    if (amount < 0) {
      console.log("claiming delve task error: amount must be positive");
      return 0;
    }

    const command = this.generateBasicCommand(job, 0);
    job.active += amount-1; // track active workparts, not creeps, account for +1 in generateBasicCommand
    command.amount = amount;
    dwarf.commands.push(command);
    return 0;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    const command = dwarf.commands[0];
    if (!command || !command.resourceType) {
      console.log("no command for delve task??");
      return false;
    }

    let range = 1
    let travelTarget = command.target;
    const travelPos = command.pos;

    let harvestMulti = 0;
    let depositAmount = 0;
    let container;

    // if there's a container, go to it instead
    const delveTarget = Game.getObjectById(command.target);
    let extractor: StructureExtractor | undefined;
    if (delveTarget) {
      let delveAtlas
      if (delveTarget instanceof Source) {
        depositAmount = delveTarget.energy
        if (depositAmount === 0) return true;

        harvestMulti = HARVEST_POWER;
        delveAtlas = g.atlas.rooms[delveTarget.pos.roomName].sources[command.target as Id<Source>];
      } else if (delveTarget instanceof Mineral) {
        depositAmount = delveTarget.mineralAmount
        if (depositAmount === 0) return true;

        harvestMulti = HARVEST_MINERAL_POWER
        delveAtlas = g.atlas.rooms[delveTarget.pos.roomName].minerals[command.target as Id<Mineral>];

        extractor = delveTarget.pos.findInRange(FIND_STRUCTURES, 0, { filter: s => s.structureType === STRUCTURE_EXTRACTOR })[0] as StructureExtractor | undefined;
        if (!extractor) {
          console.log("delve error: no extractor found");
          return false;
        }
        if ((extractor ).cooldown >= 1) {
          return undefined;
        }
      } else {
        console.log("delve error: target is not source or mineral");
        return false;
      }

      if (delveAtlas.container) {
        const containerEntity = Game.getObjectById(delveAtlas.container)
        if(containerEntity && creep.room.lookForAt(LOOK_CREEPS, containerEntity).length===0){
          // if there's a container, mine from it instead to save time
          container = delveAtlas.container;
          travelTarget = delveAtlas.container;
          range = 0;
        }
      }
    }

    const traveling = this.travel(creep, travelTarget, travelPos, range);
    if (traveling !== true) return traveling;

    if (dwarf.info.working || extractor && extractor.cooldown > 0) return undefined;

    if (!delveTarget) {
      console.log("typescript-enforced check failed in delvetask")
      return false
    }

    const result = creep.harvest(delveTarget );
    switch (result) {
      case OK:
        dwarf.info.working = true;
        // use current work parts to account for depleted sources and minerals
        // eslint-disable-next-line no-case-declarations
        const delveAmount = Math.min(creep.getActiveBodyparts(WORK) * harvestMulti, depositAmount);

        // if there is internal storage, the creep is not a dedicated miner.
        if (creep.store.getCapacity() > 0 && creep.store.getFreeCapacity() <= delveAmount) {
          if (!dwarf.info.cargo) dwarf.info.cargo = {}

          dwarf.info.cargo[command.resourceType] = creep.store[command.resourceType] + creep.store.getFreeCapacity()
          return true
        }

        if (!container) return undefined
        g.atlas.LogContainerAdd({ roomId: delveTarget.pos.roomName, containerId: container, amount: delveAmount, type: command.resourceType })
        return undefined
      default:
        console.log("unhandled error in delvetask! " + result.toString())
    }
    return false;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command) {
      console.log("delve complete typescript error");
      return false;
    }

    const job = jobs.find(j => j.id === command.jobId);
    if (job) job.active -= command.amount-1; // track active workparts, not creeps, account for -1 in unclaimJob
    return this.unclaimJob(jobs, command.jobId, 0);
  }
  public maxResource(job: Job): number {
    return this.limitedTaskMaxResource(job);
  }
}

// repair structure
class RestoreTask extends Task {
  public efficiency(simDwarf: Dwarf, simStore: SimpleStore, simPos: RoomPosition, job: Job, timeAdjustment = 0): Evaluation {
    const maxAmount = simStore[RESOURCE_ENERGY] || 0;
    if (maxAmount <= 0 || job.amount <= 0) {
      return { normalized: 0, score: 0, amount: 0, time: 0 };
    }

    const amount = Math.min(maxAmount, job.amount);

    // todo: pathfinding length. v low priority
    const distance = 1.1*Tools.maxDistance(simPos, job.pos) + 1.1*timeAdjustment;
    const time = distance + Math.ceil(amount / (simDwarf.info.workParts * REPAIR_POWER / REPAIR_COST))

    // amount*lifetime / spawncost*distance
    // priority should be a number between ~0 and ~2, default 1.
    const score = job.priority * (amount*1500) / (simDwarf.info.spawnCost*(time+.1)); // +.1 avoids div/0 err

    return { normalized: 0, score, amount, time };
  }

  public claim(dwarf: Dwarf, creep: Creep, job: Job, amount: number): number {
    if (amount < 0) {
      console.log("claiming carve task error: amount must be positive");
      return 0;
    }

    const command = this.generateBasicCommand(job, amount);
    dwarf.commands.push(command);
    return amount;
  }

  public do(dwarf: Dwarf, creep: Creep): boolean | undefined {
    if (!dwarf.info.cargo || dwarf.info.cargo[RESOURCE_ENERGY] === undefined) {
      console.log("restore cargo error");
      return false;
    }

    const command = dwarf.commands[0];
    if (!command) {
      console.log("no command for restore task??");
      return false;
    }

    const traveling = this.travel(creep, command.target, command.pos, 3)
    if (traveling !== true) return traveling

    if (dwarf.info.working) return undefined;

    const target = Game.getObjectById(command.target) as AnyOwnedStructure;
    if (target.hits === target.hitsMax) return true
    const result = creep.repair(target)

    switch (result) {
      case OK:
        dwarf.info.working = true;

        // use current work parts to account for damage
        // eslint-disable-next-line no-case-declarations
        const workParts = creep.getActiveBodyparts(WORK)
        // eslint-disable-next-line no-case-declarations
        const restoreAmount = Math.min(workParts, dwarf.info.cargo[RESOURCE_ENERGY], Math.ceil((target.hitsMax - target.hits) / REPAIR_POWER));
        command.amount -= restoreAmount;
        dwarf.info.cargo[RESOURCE_ENERGY] -= restoreAmount;
        if (restoreAmount < workParts) {
          return true;
        }
        return undefined;
      case ERR_NOT_ENOUGH_ENERGY:
        dwarf.info.cargo[RESOURCE_ENERGY] = 0
        console.log("restore error: not enough energy");
        break;
      default:
        console.log(`Unhandled error in restore! ${JSON.stringify(command)} ${result}`);
        break;
    }

    return true;
  }

  public complete(dwarf: Dwarf, jobs: Job[], success: boolean): boolean {
    const command = dwarf.commands.shift();

    // satisfy typescript
    if (!command) {
      console.log("restore complete typescript error");
      return false;
    }

    let returnAmount = 0
    if (!success) returnAmount = command.amount
    return this.unclaimJob(jobs, command.jobId, returnAmount);
  }
  public maxResource(job: Job): number {
    return this.limitedTaskMaxResource(job);
  }
}

const econTasks: { [key: string]: Task } = {
  "deliver": new DeliverTask(),
  "carve": new CarveTask(),
  "refine": new RefineTask(),
  "colonize": new ColonizeTask(),
  "delve": new DelveTask(),
  "restore": new RestoreTask()
}
export { econTasks, Task, Evaluation };
