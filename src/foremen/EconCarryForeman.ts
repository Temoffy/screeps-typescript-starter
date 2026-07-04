/* eslint-disable @typescript-eslint/prefer-for-of */

import { BaseEconForeman } from "./BaseEconForeman";
import { Dwarf } from "./BaseForeman";
import { Job } from "JobBoard";
import { econTasks } from "econTasks";

class EconCarryForeman extends BaseEconForeman {
    protected jobs: Job[];
    protected foremanName = "econCarryForeman";
    protected lastJobAssignmentTick = 0;
    public constructor() {
        super();
        this._memberTypes = {
            "h": "hauler",
        };
        this.jobs = [];
    }
    private updateTasks() {
        for (const dwarf of this.dwarves) {
            this.removeDwarfTasks(dwarf);
        }
        for (const dwarf of this.dwarves) {
            const job = this.jobs.find(j => j.id === dwarf.commands[0]?.jobId);
            if (!job || job.type !== "delve" || job.active < job.amount) {
                this.removeDwarfTasks(dwarf);
            }
        }

        for(const dwarf of this.dwarves){
            const creep = Game.getObjectById(dwarf.id)
            if(!creep) continue
            for(const resourceType in creep.store){
                dwarf.info.cargo[resourceType as ResourceConstant] = creep.store[resourceType as ResourceConstant];
            }
        }

        const jobOptions = this.jobs.filter(job => job.amount > 0);
        const dwarfOptions = this.dwarves.filter(dwarf => !dwarf.info.remove && !dwarf.commands[0]);
        this.assignTasksByMatrix(jobOptions, dwarfOptions);

        // TODO: deep copy the cargo so I don't have to do this
        for(const dwarf of this.dwarves){
            const creep = Game.getObjectById(dwarf.id)
            if(!creep) continue
            for(const resourceType in creep.store){
                dwarf.info.cargo[resourceType as ResourceConstant] = creep.store[resourceType as ResourceConstant];
            }
        }

    }
    private removeDwarfTasks(dwarf: Dwarf) {
        while (dwarf.commands.length > 0) {
            if(!econTasks[dwarf.commands[0].type].complete(dwarf, this.jobs, false)){
                console.log(`failed to properly unclaim ${JSON.stringify(dwarf.commands)}`)
            }
        }
    }
    public run() {
        for (const job of this.jobs) {
            const text: string[] = []
            for(const key of ["type"]){

                let val: any = job[key as keyof Job]
                if(typeof val === "number"){
                    const valTest = val.toFixed(2);
                    if(valTest.length < val.toString().length) val = valTest;
                }
                text.push(`${key.substring(0,3)}: ${JSON.stringify(val)}`);
            }
            g.hud.makeElement(`EcCaFo${job.id}`, job.pos, text, undefined, {scale: "small"});
        }

        for (const dwarf of this.dwarves) {
            const creep = Game.getObjectById(dwarf.id);
            if (!creep) {
                dwarf.info.remove = true;
                continue;
            }
            dwarf.info.working = false;

            g.hud.makeElement(`dwarf${dwarf.id}`, creep.pos, undefined, undefined, {line: true, scale: "small"})

            // can work on 2 tasks per tick, ie work on one, move towards the next.
            for(let i = 0; i < 4; i++){
                if(dwarf.commands.length === 0 && Game.time-this.lastJobAssignmentTick>10 && Game.cpu.bucket > 100){
                    this.updateTasks();
                    this.lastJobAssignmentTick = Game.time;
                    g.hud.addText('', "updated carry tasks")
                }
                if (dwarf.commands.length === 0) {
                    creep.say("❌🛠", true)
                    continue;
                }
                let resolveTask;
                const command = dwarf.commands[0];
                if (econTasks[command.type]) resolveTask = econTasks[command.type].do(dwarf, creep);
                else console.log("unknown econ carry task type");

                // g.hud.addText(`dwarf${dwarf.id}`, `task count:${dwarf.commands.length}`)
                // g.hud.addText(`dwarf${dwarf.id}`, `${JSON.stringify(resolveTask)}`)
                // g.hud.addText(`dwarf${dwarf.id}`, `type:${JSON.stringify(command.type)}`)
                // g.hud.addText(`dwarf${dwarf.id}`, `id:${JSON.stringify(command.jobId)}`)
                // g.hud.addText(`dwarf${dwarf.id}`, `target:${JSON.stringify(command.target)}`)

                if(resolveTask === undefined) break;
                econTasks[command.type].complete(dwarf, this.jobs, true);
            }

            for(const command of dwarf.commands){
                g.hud.addSecondaryPoint(`dwarf${dwarf.id}`, command.pos);
            }
        }
    }
    public assignCreep(creep: Creep, role: string): boolean {
        role = this._memberTypes[role];
        if (!role) return false;

        const newDwarf: Dwarf = {
            role,
            id: creep.id,
            commands: [],
            info: {
                remove: false,
                workParts: creep.getActiveBodyparts(WORK),
                carryParts: creep.getActiveBodyparts(CARRY),
                spawnCost: creep.body.reduce((cost, part) => cost + BODYPART_COST[part.type], 0),
                cargo: {},
                working: false
            }
        }
        if(newDwarf.info.carryParts > 0){
            for(const resourceType in creep.store){
                newDwarf.info.cargo[resourceType as ResourceConstant] = creep.store[resourceType as ResourceConstant];
            }
        } else{
            console.log(`why is there a creep in econ carry that has no carry? ${creep.name} ${creep.pos.roomName}`)
            return false
        }
        this.dwarves.push(newDwarf);
        return true;
    }
    public update(): number {
        let score = 0.1;
        const currentJobs = new Set(this.jobs.map(job => job.id));
        this.jobs = g.jobBoard.UpdateEconCarryPartJobs(this.jobs);
        const newJobs = this.jobs.filter(job => !currentJobs.has(job.id));
        score += newJobs.length;
        return score;
    }
}


export {EconCarryForeman}
