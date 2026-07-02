/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*
Telos, ᏘᎼᏗ
June 2025
screeps bot rewrite based on https://github.com/screepers/screeps-typescript-starter
reason: had enough of type errors in runtime, implement task manager type systems
*/

import { WorldAtlas } from "WorldAtlas";
import { JobBoard } from "JobBoard";
import Hud from "utils/Hud";
import {Tools} from "utils/Tools";
import { creepHandler } from "foremen/CreepHandler";
import { Prioritizer } from "Prioritizer";

declare global {
  interface Memory {
    uuid: number;
    log: any;
    worldAtlas: any;
    jobBoard: any;
    prioritizer: any;
  }

  interface Creep {
    _say: (message: string, public?: boolean) => 0|-1|-4;
  }

}
// Syntax for adding properties to `global` (ex "global.log")
declare const global: {
  log: any;
  g: {
    atlas: WorldAtlas;
    jobBoard: JobBoard;
    hud: Hud;
  }
}

// monkeypatching
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const _say = Creep.prototype.say;
Creep.prototype.say = function(message, sayPublic = true) {
    return _say.call(this, message, sayPublic);
};

// declare my global variables, used 'g' instead of 'global' because it's shorter and I'm lazy.
global.g = {atlas: new WorldAtlas(), jobBoard: new JobBoard(), hud: new Hud()};

console.log("Hello World!")

for( const room in Game.rooms){
  g.atlas.SurveyRoom(room)
}
g.atlas.WriteMem()

const prioritizer = new Prioritizer();
for(const updateFunction of creepHandler.getUpdateFunctions()){
  prioritizer.schedule(updateFunction.func, updateFunction.name, 1, 10);
}

module.exports.loop = function (){
  g.hud.makeElement("", Game.spawns.Spawn1.pos);
  prioritizer.run();
  for(const creepId in Game.creeps){
    const creep = Game.creeps[creepId];
    if(creep.spawning) continue;
    creepHandler.assignCreep(creep);
  }
  creepHandler.run();
  prioritizer.writeMem();

  g.hud.display();
}
