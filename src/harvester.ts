
import { min } from "lodash"
import jobBoard from "./jobBoard"

function harvestFilter(job: Job) {
  return(job.type == "staticHarvest")
}

function plan(creep: Creep, state: CreepState, jobList: Job[]) {
  let map = global.map.rooms
  if(creep.ticksToLive && creep.ticksToLive < 25 ) {
    creep.suicide()
    return false
  }
  //console.log("harvest planning")

  let plannedPos = creep.pos
  let myJob = jobBoard.getJob(jobList, harvestFilter, creep.getActiveBodyparts(WORK), plannedPos, plannedPos) as HarvestJob | boolean
  if(!myJob) {
    return false
  }
  myJob = myJob as HarvestJob
  let newCommand = { "type": myJob.type, "target": myJob.target as Id<Source> | Id<Mineral>/*jank todo*/, pos: myJob.pos, "amount": 0, "job": myJob.id }
  state.commands.push(newCommand)
  myJob.active++

  let targetSource = global.map.getSourceFromID(myJob.target)
  if(targetSource){
    targetSource.spaces--
    targetSource.workCap -= 20;
  } else{
    let targetMinerals = global.map.getMineralFromID(myJob.target)
    if(targetMinerals){
      targetMinerals.spaces--
    }
  }
  return true
}

function resolve(state: CreepState, jobs: Job[], successful: boolean) {
  let map = global.map.rooms
  let command = state.commands[0]
  console.log("resolving harvest "+JSON.stringify(state))
  if(command.job) {
    let refJob = jobBoard.getJobFromID(jobs, command.job)
    if(!refJob) {
      console.log("resolve harvest job not found")
      return "allBroken"
    }
    refJob.active--
  }
  let returnCode = "resolved"
  switch(command.type) {
    case "staticHarvest":
      let targetSource = global.map.getSourceFromID(command.target)
      if(!targetSource){
        let targetMinerals = global.map.getMineralFromID(command.target)
        if(targetMinerals){
          targetMinerals.spaces++
          let mineral = Game.getObjectById(targetMinerals.id)
          if(mineral?.mineralAmount==0){
            let job1 = command.job? jobBoard.getJobFromID(jobs,command.job): undefined
            job1? job1.amount = 0: undefined
          }
          state.commands.shift()
          return returnCode
        } else{
          console.log("EMERGENCY! I HAVEN'T SET UP DEPOSIT HANDLING")
          return "allBroken"
        }
      }
      targetSource.spaces++
      targetSource.workCap += 20
      break
    default:
        console.log("EMERGENCY! I HAVEN'T SET UP DEPOSIT HANDLING ROLES")

  }
  if(command.job != null && !successful) {
    let job1 = jobBoard.getJobFromID(jobs, command.job) as Job
    job1.amount += command.amount
  }

  state.commands.shift()
  return returnCode
}

// Helper function to compare two RoomPosition-like objects
function isPosEqualTo(posA: RoomPosition, posB: RoomPosition) {
    return posA.x === posB.x && posA.y === posB.y && posA.roomName === posB.roomName
}

function staticHarvest(creep: Creep, state: CreepState){
  let source = Game.getObjectById(state.commands[0].target)
  if(!source && state.commands[0].pos){
    //not yet in room, move to
    let targetPos = new RoomObject(state.commands[0].pos.x, state.commands[0].pos.y ,state.commands[0].pos.roomName)
    creep.moveTo(targetPos)
    return false
  } else if(source){
    if(source instanceof Source){
      let mapSource = global.map.getSourceFromID(source.id)
      if(mapSource && mapSource.container){
        let container = Game.getObjectById(mapSource.container)
        if(container && isPosEqualTo(creep.pos, container.pos)){
          let result = creep.harvest(source)
          if(result == 0){
            let containersMem = global.map.rooms[creep.pos.roomName].containers
            let containerMem = containersMem? containersMem[mapSource.container]: undefined
            if(containerMem){
              let amount = Math.min(state.info.workParts*2, container.store.getFreeCapacity(RESOURCE_ENERGY))
              global.map.containerAdd.push({roomId: container.pos.roomName, containerId: container.id, type: RESOURCE_ENERGY, amount: amount})
            }
              return false
          } else if(result == -6) return false
          console.log("BUGGED STATIC HARVEST CODE!!, CANNOT HARVEST!")
          creep.say("!?!?", true)
        }else if(container){
          //can see source, but not in position yet
          creep.moveTo(container)
        } else {
          console.log("BUGGED STATIC HARVEST CODE!!, NO CONTAINER FOUND")
          return true
        }
        return false
      } else {
        //no container, put it on the ground
        let result = creep.harvest(source)
        if(!result) creep.moveTo(source)
        return false
      }
    } else if(source instanceof Mineral){
      let mapSource = global.map.getMineralFromID(source.id)
      if(mapSource && mapSource.container){
        let container = Game.getObjectById(mapSource.container)
        if(container && isPosEqualTo(creep.pos, container.pos)){
          let extractor = source.pos.findInRange(FIND_STRUCTURES, 0, {
            filter: (structure) => (structure.structureType == STRUCTURE_EXTRACTOR)
          }) as StructureExtractor[]
          if(extractor.length && extractor[0].cooldown>0){
            return false
          }
          if(source.mineralAmount==0){
            return true
          }
          let result = creep.harvest(source)
          if(result == 0 || result == -6){
            return false
          }
          console.log("BUGGED STATIC HARVEST CODE!!, CANNOT HARVEST!")
          creep.say("!?!?", true)
        }else if(container){
          //can see source, but not in position yet
          creep.moveTo(container)
        } else {
          console.log("BUGGED STATIC HARVEST CODE!!, NO CONTAINER FOUND")
          return true
        }
        return false
      }
    } else{
      console.log("HANDLE DEPOSIT MINING")
    }
  }
  return false
}

const harvester = {
  run(creepState: CreepState, jobList: Job[]){
    let creep = Game.getObjectById(creepState.id)

    if(creep == null || creepState.info.remove){
      while(creepState.commands.length>0){
        resolve(creepState, jobList, false)
      }
      return "deadCreep"
    }

    let resolveTask = false
    let resolveMessage = "working"
    if(creepState.commands.length == 0){
      plan(creep, creepState, jobList)
    }
    if(creepState.commands.length == 0){
      creep.say("❌🛠, 💔", true)
      return "noWork"
    }

    resolveTask = false
    switch(creepState.commands[0].type) {
      case "staticHarvest":
        if(staticHarvest(creep, creepState)) {
          creep.say("⛏⛏⛏??", true)
          resolveTask = true
        }
        break
      default:
        console.log("unknown jobtype in creepstate:", JSON.stringify(creepState))
    }
    if(resolveTask) {
      resolveMessage = resolve(creepState, jobList, true)
    }
    return resolveMessage
  },
  remove(creepState: CreepState, jobs: Job[]){
    while(creepState.commands.length > 0) {
      resolve(creepState, jobs, false)
    }
  }
}

export default harvester
