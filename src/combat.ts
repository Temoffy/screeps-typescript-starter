function resolve(state: CreepState, jobs: Job[], successful: boolean) {
  let returnCode = "resolved";
  return returnCode;
}

const combat = {
  run(creepState: CreepState, jobList: Job[]) {
    let resolveMessage = "working";
    let creep = Game.getObjectById(creepState.id) as Creep;
    if (!creep) {
      creepState.info.remove;
      return "deadCreep";
    }
    switch (creepState.role) {
      case "poke":
        creep.moveTo(Game.flags["poke1"]);
        break;
      case "drain":
        if (creep.hits != creep.hitsMax) {
          creep.heal(creep);
          let startrun = creep.hits >= creep.hitsMax - creep.getActiveBodyparts(HEAL) * 12;
          creep.moveTo(Game.flags[startrun ? "poke1" : "recover1"]);
        } else {
          if (Game.rooms[creep.pos.roomName].controller?.owner?.username != "Temoffy") {
            return resolveMessage;
          }
          creep.moveTo(Game.flags["poke1"]);
        }

        break;
      default:
        break;
    }
    return resolveMessage;
  },
  remove(creepState: CreepState, jobs: Job[]) {
    while (creepState.commands.length > 0) {
      resolve(creepState, jobs, false);
    }
  }
};

export default combat;
