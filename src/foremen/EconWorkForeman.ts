/* eslint-disable @typescript-eslint/prefer-for-of */

// EconWorkForeman.ts

import { SpawnRequest } from "muster/muster";
import { BaseEconForeman } from "./BaseEconForeman";
import { Dwarf } from "./BaseForeman";
import { Job } from "JobBoard";
import { econTasks } from "econTasks";

interface WorkRegion{
    coreRoom: string;
    workParts: number;
}

class EconWorkForeman extends BaseEconForeman {
    protected jobs: Job[];
    protected foremanName = "econWorkForeman";
    protected lastJobAssignmentTick = 0;
    public constructor() {
        super();
        this._memberTypes = {
            "w": "worker",
            "md": "mobileDelver",
        };
        this.jobs = [];
    }
    private updateTasks() {
        const econWorkDwarves = this.dwarves.filter(d => d.role !== "mobileDelver")
        for (const dwarf of econWorkDwarves) {
            this.removeDwarfTasks(dwarf);
        }
        for (const dwarf of econWorkDwarves) {
            const job = this.jobs.find(j => j.id === dwarf.commands[0]?.jobId);
            if (!job || job.type !== "delve" || job.active < job.amount) {
                this.removeDwarfTasks(dwarf);
            }
        }

        for(const dwarf of this.dwarves.filter(d => d.info.carryParts > 0)){
            const creep = Game.getObjectById(dwarf.id)
            if(!creep) continue
            for(const resourceType in creep.store){
                dwarf.info.cargo[resourceType as ResourceConstant] = creep.store[resourceType as ResourceConstant];
            }
        }

        let jobOptions = this.jobs.filter(job => job.type === "delve" && job.active < job.amount);
        let dwarfOptions = this.dwarves.filter(dwarf => dwarf.role === "mobileDelver" && !dwarf.info.remove && !dwarf.commands[0]);
        this.assignTasksByMatrix(jobOptions, dwarfOptions);

        // all work delve or work creeps and jobs
        jobOptions = this.jobs.filter(job => job.amount > 0);
        dwarfOptions = this.dwarves.filter(dwarf => !dwarf.info.remove && !dwarf.commands[0]);
        this.assignTasksByMatrix(jobOptions, dwarfOptions);

        // TODO: deep copy the cargo so I don't have to do this
        for(const dwarf of this.dwarves.filter(d => d.info.carryParts > 0)){
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
            for(const key of ["type","amount","priority"]){
                let val: any = job[key as keyof Job]
                if(typeof val === "number"){
                    const valTest = val.toFixed(2);
                    if(valTest.length < val.toString().length) val = valTest;
                }
                text.push(`${key.substring(0,3)}: ${JSON.stringify(val)}`);
            }
            g.hud.makeElement(`EcWoFo${job.id}`, job.pos, text, undefined, {scale: "small"});
        }

        for (const dwarf of this.dwarves) {
            const creep = Game.getObjectById(dwarf.id);
            if (!creep) {
                // safer to remove in later loop
                dwarf.info.remove = true;
                this.removeDwarfTasks(dwarf);
                continue;
            }
            dwarf.info.working = false;

            g.hud.makeElement(`dwarf${dwarf.id}`, creep.pos, undefined, undefined, {line: true, scale: "small"})

            // can work on 2 tasks per tick, ie work on one, move towards the next.
            for(let i = 0; i < 4; i++){
                if(dwarf.commands.length === 0 && Game.time-this.lastJobAssignmentTick>10 && Game.cpu.bucket > 100){
                    this.updateTasks();
                    this.lastJobAssignmentTick = Game.time;
                    g.hud.addText('', "updated tasks")
                }
                if (dwarf.commands.length === 0) {
                    creep.say("❌🛠", true)
                    continue;
                }
                let resolveTask;
                const command = dwarf.commands[0];
                if (econTasks[command.type]) resolveTask = econTasks[command.type].do(dwarf, creep);
                else console.log("unknown econ work task type");

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
        for(let i = 0; i<this.dwarves.length; i++){
            if(this.dwarves[i].info.remove){
                this.dwarves.splice(i,1)
                i--
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
        }
        this.dwarves.push(newDwarf);
        return true;
    }
    public update(): number {
        let score = 0.1;
        const currentJobs = new Set(this.jobs.map(job => job.id));
        this.jobs = g.jobBoard.UpdateEconWorkPartJobs(this.jobs);
        const newJobs = this.jobs.filter(job => !currentJobs.has(job.id));
        score += newJobs.length;
        return score;
    }
    public getSpawnRequests(): SpawnRequest[] {
        const requests: SpawnRequest[] = []

        const W = WORK
        const M = MOVE
        const C = CARRY

        // TODO: make priority per-region
        const energyDelverBodies = [{body:[W,M],score:1}, {body:[W,W,M],score:2}, {body:[W,W,W,W,W,M,M,M],score:5}]
        const delverCount = this.dwarves.filter(d=>d.role==="mobileDelver").length
        for(const job of this.jobs.filter(j => j.type === "delve" && j.amount>j.active && j.space>0)){
            requests.push({
                suffix: "md",
                urgency: Math.max(4-delverCount,1),
                priority: 20,
                bodyOptions: energyDelverBodies,
                time: Game.time,
                room: job.pos.roomName,
                maxBodyScore: job.amount
            })
        }


        const workerBodies = [{body:[W,C,M],score:1}]

        let targetWorkParts = this.jobs.filter(j => j.type === "delve" && j.resourceType === RESOURCE_ENERGY).reduce((sum, j) => sum + j.active, 0)
        targetWorkParts = Math.ceil(targetWorkParts*1.5)

        const soonDeadWorkParts = this.dwarves.filter(d => d.role === "worker" && (Game.getObjectById(d.id)?.ticksToLive ?? 0) < 500).reduce((sum, d) => sum + d.info.workParts, 0);
        const currentWorkParts = this.dwarves.filter(d => d.role === "worker").reduce((sum, d) => sum + d.info.workParts, 0);

        if(currentWorkParts < targetWorkParts){
            const regions = this.getRegions()
            const targetRegion = regions.reduce((lowest, test) => test.workParts < lowest.workParts ? test : lowest)

            requests.push({
                suffix: "w",
                urgency: Math.max(3-(Math.floor(currentWorkParts/3)), 1),
                priority: 10/currentWorkParts,
                bodyOptions: workerBodies,
                time: Game.time,
                room: targetRegion.coreRoom,
                maxBodyScore: targetWorkParts - currentWorkParts - soonDeadWorkParts
            })
        }

        if(soonDeadWorkParts === 0) return requests

        for( const dwarf of this.dwarves.filter(d => d.role === "worker" && (Game.getObjectById(d.id)?.ticksToLive ?? 0) < 200)){
            requests.push({
                suffix: "w",
                urgency: 1,
                priority: currentWorkParts,
                bodyOptions: workerBodies,
                time: Game.getObjectById(dwarf.id)?.ticksToLive ?? 0,
                room: Game.getObjectById(dwarf.id)?.pos.roomName ?? "W0N0",
                maxBodyScore: targetWorkParts - currentWorkParts - soonDeadWorkParts
            })
        }

        return requests
    }
    private getRegions(): WorkRegion[]{
        const regions: WorkRegion[] = []
        for(const spawnid in Game.spawns){
            const spawn = Game.spawns[spawnid]!
            regions.push({
                coreRoom: spawn.pos.roomName,
                workParts: 0
            })
        }
        for(const dwarf of this.dwarves.filter(d=>d.role==="worker")){
            const creep = Game.getObjectById(dwarf.id)
            if(!creep) continue
            const region = regions.reduce((closest, testR) => {
                const closestDist = Game.map.getRoomLinearDistance(creep.pos.roomName, closest.coreRoom)
                const regionDist = Game.map.getRoomLinearDistance(creep.pos.roomName, testR.coreRoom)
                return regionDist < closestDist ? testR : closest
            })
            if(!region) continue

            const rDist = Game.map.getRoomLinearDistance(creep.pos.roomName, region.coreRoom)
            for(const r of regions){
                const testDist = Game.map.getRoomLinearDistance(creep.pos.roomName, r.coreRoom)
                if(testDist <= rDist || testDist < 2) r.workParts += dwarf.info.workParts
            }
        }
        return regions
    }
}


export {EconWorkForeman}
