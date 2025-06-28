const hauler = {
  run(creepState: CreepState, jobList: Job[]) {
    let creep = Game.getObjectById(creepState.id);

    if (creep == null || creepState.info.remove) {
      while (creepState.commands.length > 0) {
      }
      return "deadCreep";
    }

    let resolveTask = false;
    let resolveMessage = "working";
    if (creepState.commands.length == 0) {
    }
    if (creepState.commands.length == 0) {
      creep.say("❌🛠, 💔", true);
      return "noWork";
    }

    resolveTask = false;
    if (resolveTask) {
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
    }
  }
};

export default hauler;
