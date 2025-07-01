import sinonChai from "sinon-chai";
import jobBoard from "./jobBoard";
import task from "./tasks";

function workerFilter(job: Job) {
  return job.type == "deliver";
}

function getMostCargoType(store: { [key: string]: number }){
  let most
  let amount = 0
  for(let i in store){
    if(store[i]>amount){
      most = i
      amount = store[i]
    }
  }
  console.log("most"+most+amount)
  return most as ResourceConstant
}

function Plan(creep: Creep, state: CreepState, jobList: Job[]) {
  if (creep.ticksToLive && creep.ticksToLive < 25) {
    creep.suicide();
    return false;
  }

  if (!state.info.cargo) {
    console.log("broken hauler! no cargo");
    return false;
  }

  //get potential sources
  let storages = [];
  let creepStorage = 0;
  //current creep storage amount may not be accurate if this is a later loop
  //so sum over state cargo
  for (let i in state.info.cargo) {
    creepStorage += state.info.cargo[i];
  }
  if (creepStorage > creep.store.getCapacity() / 1.5) {
    storages.push({
      id: undefined,
      mem: { store: state.info.cargo, pos: creep.pos, rank:0 }
    });
  } else {
    for (let roomId in global.map.rooms) {
      let roomMem = global.map.rooms[roomId];
      for (let i in roomMem.containers) {
        let sum = 0;
        for (let resource in roomMem.containers[i].store) {
          if (roomMem.containers[i].store[resource] > 0) {
            sum += roomMem.containers[i].store[resource];
            break;
          }
        }
        if (sum==0 || (sum<creep.store.getCapacity()&&roomMem.containers[i].rank>0)) continue;

        storages.push({
          id: i,
          mem: roomMem.containers[i]
        });
      }
    }
  }

  //pick initial source based on distance to creep, distance to job, and job priority
  let targetJob;
  let targetScore = -999;
  let targetStorage;
  let simStorage;
  let resourceType
  for (let storage of storages) {
    simStorage = { ...storage.mem.store };
    //don't select energy sources less than most of a load
    if (simStorage[RESOURCE_ENERGY] < creep.store.getCapacity() / 1.5) {
      simStorage[RESOURCE_ENERGY] = 0
    }

    let { job: testJob, score: testScore } = jobBoard.getJob(
      jobList,
      workerFilter,
      simStorage,
      storage.mem.rank+1,
      state.info.workParts,
      creep.pos,
      storage.mem.pos
    );
    if (!testJob) {
      continue;
    }
    if (!global.tools.IsTransferJob(testJob)) {
      console.log("hauler got a weird job!" + JSON.stringify(testJob));
      continue;
    }
    if (testScore > targetScore) {
      targetJob = testJob;
      targetScore = testScore;
      targetStorage = storage;
    }
  }
  //source is now locked in and should not change

  if (!targetJob || !targetStorage) return false;

  //what other jobs can be done with one trip to the chosen source?
  let maxAmount = creep.store.getCapacity();
  resourceType = targetJob.resourceType
  if(resourceType == 'any') {
    console.log('fore')
    console.log(targetJob.amount)
    resourceType = getMostCargoType(targetStorage.mem.store)
  }
  if(resourceType == undefined){
    console.log("major error in hauler")
    return false
  }
  let currentAmount = Math.min(maxAmount, targetJob.amount, targetStorage.mem.store[resourceType]);

  let targetList = [ {job:targetJob,amount:currentAmount,resourceType:resourceType} ];
  targetJob.amount -= currentAmount;
  targetJob.active++;
  console.log(targetJob.amount)

  let newAmount = currentAmount
  if (currentAmount != maxAmount) {
    simStorage = { ...targetStorage.mem.store };
    while (currentAmount != maxAmount) {
      simStorage[resourceType] -= newAmount;
      targetJob = undefined;

      let empty = true;
      for (let resource in simStorage) {
        if (simStorage[resource] > 0) {
          empty = false;
          break;
        }
      }
      if (empty) break;

      ({ job: targetJob, score: targetScore } = jobBoard.getJob(
        jobList,
        workerFilter,
        simStorage,
        targetStorage.mem.rank+1,
        state.info.workParts,
        targetStorage.mem.pos,
        targetList[targetList.length - 1].job.pos
      ));

      if (!targetJob || !global.tools.IsTransferJob(targetJob)) break;
      resourceType = undefined
      resourceType = targetJob.resourceType
      if(resourceType == 'any') {
        console.log('fore')
        console.log(targetJob.amount)
        resourceType = getMostCargoType(simStorage)
      }
      if(resourceType == undefined){
        console.log("major error in hauler")
        return false
      }

      newAmount = Math.min(maxAmount - currentAmount, targetJob.amount, simStorage[resourceType]);
      targetList.push({job:targetJob, amount:newAmount,resourceType:resourceType});
      currentAmount+=newAmount
      console.log("pre"+targetJob.amount+" "+newAmount)
      targetJob.amount -= newAmount;
      targetJob.active++;
      console.log("post"+targetJob.amount)
    }
  }

  //put all the commands together
  //let fetchCommands: Command[] = []
  simStorage = {...state.info.cargo}
  for(let delivery of targetList){

    //if targetStorage != this creep, go get the resources. basically
    if(targetStorage.id){
      simStorage[delivery.resourceType]-=delivery.amount
    }

    let newCommand:Command = {
      type:"deliver",
      target:delivery.job.target,
      pos:delivery.job.pos,
      amount: delivery.amount,
      resourceType: delivery.resourceType,
      job:delivery.job.id
    }
    state.commands.push(newCommand)
  }

  let active = 0
  for(let i in simStorage){
    if(simStorage[i]<0 && targetStorage.id){
      let newCommand:Command = {
        type: "deliver",
        target: targetStorage.id as Id<AnyStoreStructure>,
        pos: targetStorage.mem.pos,
        amount: simStorage[i],
        resourceType: i as ResourceConstant,
      }
      state.commands.unshift(newCommand)
      targetStorage.mem.store[i] += simStorage[i];
      targetStorage.mem.active++;
    }
  }

  return true;
}

const hauler = {
  run(creepState: CreepState, jobList: Job[]) {
    let creep = Game.getObjectById(creepState.id);

    if (creep == null || creepState.info.remove) {
      this.remove(creepState, jobList);
      return "deadCreep";
    }

    if(!creepState.info.cargo) {
      console.log("no cargo in deliver creep??")
      this.remove(creepState, jobList);
      return "deadCreep"
    }

    for(let i of RESOURCES_ALL){
      creepState.info.cargo[i] = creep.store[i]
    }

    creepState.info.moving = false;
    creepState.info.working = false;
    let resolveTask: boolean | undefined = true;
    let resolveMessage = "working";
    let loop = 0;
    while (resolveTask && loop < 2) {
      loop++;
      if (creepState.commands.length == 0) {
        Plan(creep, creepState, jobList);
      }
      if (creepState.commands.length == 0) {
        creep.say("❌🛠, 💔", true);
        return "noWork";
      }

      resolveTask = undefined;
      let command = creepState.commands[0];
      if (task[command.type]) resolveTask = task[command.type].run(creep, creepState);
      else console.log("unknown hauler task type 2");

      if (resolveTask != undefined) {
        resolveMessage = "update";
        global.scheduler.jobUpdate++;
        global.scheduler.mapUpdate++;
        if (task[command.type]) resolveTask = task[command.type].resolve(creepState, jobList, resolveTask);
        else console.log("unknown hauler task type 3");
      }
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      let command = creepState.commands[0];
      if (task[command.type]) task[command.type].resolve(creepState, jobs, false);
      else console.log("unknown hauler task type 4");
    }
  }
};

export default hauler;
