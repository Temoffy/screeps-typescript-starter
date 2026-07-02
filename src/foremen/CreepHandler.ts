import {BaseForeman} from "./BaseForeman"
import { EconWorkForeman } from "./EconWorkForeman";
import { EconCarryForeman } from "./EconCarryForeman";

class CreepHandler {
    private foremen: BaseForeman[] = [];

    public registerForeman(newBoss: BaseForeman) {
        this.foremen.push(newBoss);
    }
    public run() {
        for (const foreman of this.foremen) {
            foreman.run();
        }
    }
    public assignCreep(creep: Creep): boolean {
        const nameparts = creep.name.split("-");
        const role = nameparts[nameparts.length - 1];
        for (const foreman of this.foremen) {
            if (foreman.memberTypes.includes(role)) {
                if(foreman.memberIDs.includes(creep.id)) return true;
                if (foreman.assignCreep(creep, role)) return true;
            }
        }
        return false;
    }
    public getUpdateFunctions(): {func:() => number, name: string}[] {
        return this.foremen.map(foreman => ({func: () => foreman.update(), name: foreman.name}));
    }
}


const creepHandler = new CreepHandler();
creepHandler.registerForeman(new EconWorkForeman());
creepHandler.registerForeman(new EconCarryForeman());

export { creepHandler };
