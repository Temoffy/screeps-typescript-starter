import { min } from "lodash";
import jobBoard from "./jobBoard";
import task from "./tasks";

function harvestFilter(job: Job) {
  return job.type == "delve";
}

function plan(creep: Creep, state: CreepState, jobList: Job[]) {
  let map = global.map.rooms;
  if (creep.ticksToLive && creep.ticksToLive < 25) {
    creep.suicide();
    return false;
  }
  //console.log("harvest planning")

  let plannedPos = creep.pos;
  let myJob = jobBoard.getJob(jobList, harvestFilter, creep.getActiveBodyparts(WORK), plannedPos, plannedPos) as
    | HarvestJob
    | boolean;
  if (!myJob) {
    return false;
  }
  myJob = myJob as HarvestJob;
  let newCommand = {
    type: myJob.type,
    target: myJob.target as Id<Source> | Id<Mineral> /*jank todo*/,
    pos: myJob.pos,
    amount: 0,
    job: myJob.id
  };
  state.commands.push(newCommand);
  myJob.active++;

  let targetSource = global.map.getSourceFromID(myJob.target);
  if (targetSource) {
    targetSource.spaces--;
    targetSource.workCap -= 20;
  } else {
    let targetMinerals = global.map.getMineralFromID(myJob.target);
    if (targetMinerals) {
      targetMinerals.spaces--;
    }
  }
  return true;
}

// Helper function to compare two RoomPosition-like objects
function isPosEqualTo(posA: RoomPosition, posB: RoomPosition) {
  return posA.x === posB.x && posA.y === posB.y && posA.roomName === posB.roomName;
}

const harvester = {
  run(creepState: CreepState, jobList: Job[]) {
    let creep = Game.getObjectById(creepState.id);

    if (creep == null || creepState.info.remove) {
      while (creepState.commands.length > 0) {
        let command = creepState.commands[0]
        task[command.type].resolve(creepState,jobList,false)
        //resolve(creepState, jobList, false);
      }
      return "deadCreep";
    }

    let resolveTask = false;
    let resolveMessage = "working";
    if (creepState.commands.length == 0) {

      plan(creep, creepState, jobList);
    }
    if (creepState.commands.length == 0) {
      creep.say("❌🛠, 💔", true);
      return "noWork";
    }

    resolveTask = false;
    let command = creepState.commands[0]
    resolveTask = task[command.type].run(creep, creepState)
    /*switch (creepState.commands[0].type) {
      case "delve":
        if (staticHarvest(creep, creepState)) {
          creep.say("⛏⛏⛏??", true);
          resolveTask = true;
        }
        break;
      default:
        console.log("unknown jobtype in creepstate:", JSON.stringify(creepState));
    }*/
    resolveMessage = task[command.type].resolve(creepState,jobList,resolveTask)//resolve(creepState, jobList, true);
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      let command = creepState.commands[0]
      task[command.type].resolve(creepState,jobs,false)
      //resolve(creepState, jobs, false);
    }
  }
};

export default harvester;
