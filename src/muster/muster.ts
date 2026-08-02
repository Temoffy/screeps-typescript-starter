// muster.ts
import { findBestSlot, reserveSlot } from "./schedule";
import { Tools } from "utils/Tools";

// priority and spawning behavior modifier
enum SpawnUrgency {
  extraneous = 0,
  eventual = 1, // will wait for energy refill to spawn optimal body
  needed = 2,
  urgent = 3, // not wait for energy, will spawn suboptimal body
  panic = 4
}

interface SpawnRequest {
  readonly suffix: string; // role marker
  readonly urgency: SpawnUrgency;
  readonly priority?: number; // allow sorting within same urgency, integer
  readonly bodyOptions: {body:BodyPartConstant[],score:number}[]; // spawn most expensive variation accounting for repeat min/max
  readonly minBodyScore?: number; // multipliers for bodyOptions within a single creep
  readonly maxBodyScore?: number;
  readonly targetBodyScore?: number; // total target body array repeats across all creeps, for example, if you want 3 creeps with 2 repeats of a body, set this to 6 with a max repeat of 2.
  readonly time: number; // target completion time
  readonly room: string; // destination, actual might vary based on availability and priority.
  plannedTime?: number;
}

interface SpawnInfo {
  pos: Pos;
  name: string;
  energy: number;
  energyCap: number;
  availableTimes: [start: number, end: number][];
  schedule: SpawnRequest[];
}

class Muster {
  private requestSources: (() => SpawnRequest[])[] = [];
  private spawnSchedules: { [key: string]: SpawnRequest[] } = {};

  public addRequestSource(source: () => SpawnRequest[]): void {
    this.requestSources.push(source);
  }

  public updateSpawnSchedules(): number {
    const oldSchedules: string[] = []
    for (const spawnerId in this.spawnSchedules){
      oldSchedules.push(... this.spawnSchedules[spawnerId].map(a => `${a.suffix}${a.urgency}${Math.max(a.time,Game.time+5)}`))
    }

    const spawnNames = Object.keys(Game.spawns);
    spawnNames.forEach(a => console.log(a));

    const spawnInfos: SpawnInfo[] = spawnNames.map(spawnerName => {
      const spawner = Game.spawns[spawnerName];
      const pos = spawner.pos;
      const energy = spawner.room.energyAvailable;
      const energyCap = spawner.room.energyCapacityAvailable;
      const availableTimes: [start: number, end: number][] = [];
      const firstInterval: [start: number, end: number] = [
        Game.time + (spawner.spawning?.remainingTime ?? 0),
        Game.time + 1000
      ];
      availableTimes.push(firstInterval); // Placeholder for actual availability logic
      const schedule: SpawnRequest[] = []; // this.spawnSchedules[spawnerName] || [];
      return { pos, name: spawnerName, energy, energyCap, availableTimes, schedule };
    });

    const requests = this.requestSources.flatMap(source => source());

    this.assignRequestsByMatrix(spawnInfos, requests);

    const newSchedules: string[] = []
    for (const spawnerId in this.spawnSchedules){
      newSchedules.push(... this.spawnSchedules[spawnerId].map(a => `${a.suffix}${a.urgency}${Math.max(a.time,Game.time+5)}`))
    }
    console.log(`Muster: old schedules: ${JSON.stringify(oldSchedules)} new schedules: ${JSON.stringify(newSchedules)}`)
    // eslint-disable-next-line @typescript-eslint/no-for-in-array
    for(let oldI = 0; oldI < oldSchedules.length; oldI++){
      const newI = newSchedules.findIndex(a => a === oldSchedules[oldI])
      if(newI === -1) continue
      oldSchedules.splice(oldI, 1)
      oldI--
      newSchedules.splice(Number(newI), 1)
    }
    return Math.max(oldSchedules.length, newSchedules.length)
  }

  private assignRequestsByMatrix(spawnInfos: SpawnInfo[], requests: SpawnRequest[]): void {
    const urgencyGroups = this.groupBy(requests, "urgency");
    const sortedUrgencies = Object.keys(urgencyGroups).sort((a, b) => Number(b) - Number(a));
    for (const urgency of sortedUrgencies) {
      console.log(`Processing urgency level: ${urgency}`);
      const groupRequests = urgencyGroups[urgency];

      const requestMatrix: { normalized: number; score: number }[][] = [];
      for (const spawnInfo of spawnInfos) {
        requestMatrix.push([]);
        for (const request of groupRequests) {
          const score = this.calculateScore(spawnInfo, request);
          requestMatrix[requestMatrix.length - 1].push({ normalized: 0, score });
        }
      }

      while (groupRequests.length > 0 && spawnInfos.length > 0 && Game.cpu.bucket > 20) {
        this.normalizeMatrix(requestMatrix);
        const best = this.findBestMatrixCoords(requestMatrix);

        if (best.i === -1 || best.j === -1) break;

        const bestRequest = groupRequests[best.j];
        const bestSpawn = spawnInfos[best.i];
        console.log(JSON.stringify(requestMatrix));
        console.log(JSON.stringify(bestSpawn));
        bestSpawn.schedule.push(bestRequest);
        this.insertIntervalFromRequest(bestSpawn.availableTimes, bestRequest, bestSpawn);

        // remove request
        requestMatrix.forEach(a => a.splice(best.j, 1));
        groupRequests.splice(best.j, 1);

        requestMatrix[best.i].forEach((a, j) => {
          requestMatrix[best.i][j].score = this.calculateScore(spawnInfos[best.i], groupRequests[j]);
        });

        // const testSum = _.sum(requestMatrix[best.i].map(a => a.score));
        // if (testSum === 0) requestMatrix.splice(best.i, 1);
      }
    }
    for (const info of spawnInfos) {
      this.spawnSchedules[info.name] = info.schedule;
    }
  }

  private calculateScore(spawnInfo: SpawnInfo, request: SpawnRequest): number {
    // TODO: score based on room in schedule, 2x travel time,
    const bestBody = this.getCreepBuildArray(request, spawnInfo.energyCap);
    return Math.min(Math.random(), bestBody.length); // Placeholder for actual scoring logic
  }

  private normalizeMatrix(matrix: { normalized: number; score: number }[][]): void {
    if (matrix.length === 0 || matrix[0].length === 0) return;

    for (let j = 0; j < matrix[0].length; j++) {
      let sum = 1;
      if (matrix.length > 1) {
        sum = _.sum(matrix.map(row => row[j].score));
      }
      if (sum === 0) {
        matrix.forEach(row => (row[j].normalized = 0));
        continue;
      }
      matrix.forEach(row => (row[j].normalized = row[j].score / sum));
    }

    for (const row of matrix) {
      let sum = 1;
      if (matrix[0].length > 1) {
        sum = _.sum(row.map(cell => cell.normalized));
      }
      if (sum === 0) {
        row.forEach(cell => (cell.normalized = 0));
        continue;
      }
      row.forEach(cell => (cell.normalized /= sum));
    }
  }

  // split array of type T into Record/Dict of T arrays sorted and indexed by desired property values
  // ie: [{a:z}, {a:z}, {a:x}] => { z:[{a:z},{a:z}], x:[{a:x}] }
  private groupBy<T>(arr: T[], property: keyof T): Record<string, T[]> {
    return arr.reduce<Record<string, T[]>>(function (memo, x) {
      const key = String(x[property]);
      (memo[key] ??= []).push(x);
      return memo;
    }, {});
  }

  protected findBestMatrixCoords(matrix: { score: number; normalized: number }[][]): { i: number; j: number } {
    const iLen = matrix.length;
    const jLen = matrix[0].length;
    if (iLen === 0 || jLen === 0) return { i: -1, j: -1 };
    let best = { i: -1, j: -1, score: 0 };
    for (let i = 0; i < iLen; i++) {
      for (let j = 0; j < jLen; j++) {
        if (matrix[i][j].normalized > best.score) {
          best = { i, j, score: matrix[i][j].normalized };
        }
      }
    }
    return { i: best.i, j: best.j };
  }

  private insertIntervalFromRequest(
    times: [start: number, end: number][],
    request: SpawnRequest,
    spawnInfo: SpawnInfo
  ) {
    let spawnTime = 0;
    if ([SpawnUrgency.extraneous, SpawnUrgency.eventual, SpawnUrgency.needed].includes(request.urgency)) {
      spawnTime = this.getCreepBuildArray(request, spawnInfo.energyCap).length * 3;
    } else if ([SpawnUrgency.urgent, SpawnUrgency.panic].includes(request.urgency)) {
      spawnTime = this.getCreepBuildArray(request, spawnInfo.energy).length * 3;
    }
    const startTime =
      request.time - spawnTime - Tools.maxDistance({ x: 25, y: 25, roomName: request.room }, spawnInfo.pos);
    request.plannedTime = reserveSlot(spawnInfo.availableTimes, startTime, spawnTime);
  }

  private getCreepBuildArray(request: SpawnRequest, maxCost: number): BodyPartConstant[] {
    let bestI = 0;
    let bestMultipl = 0;
    let bestBodyScore = 0
    let bestCost = 0;
    request.bodyOptions.forEach((option, i) => {
      const baseCost = _.sum(option.body, b => BODYPART_COST[b]);
      const testMulti = Math.min(
        Math.floor(maxCost / baseCost),
        Math.floor(50 / option.body.length),
        Math.floor( (request.maxBodyScore??1000)/option.score)
      );
      if ( 0 < (testMulti*option.score - bestBodyScore || bestCost - baseCost*testMulti)) {
        bestI = i;
        bestMultipl = testMulti;
        bestCost = baseCost * testMulti;
        bestBodyScore = bestMultipl*option.score
      }
    });

    if (bestBodyScore < (request.minBodyScore ?? request.targetBodyScore ?? 1)) return [];

    // duplicate all elements of chosen body bestMultipl times (keep order)
    return request.bodyOptions[bestI].body.flatMap(i => Array.from({ length: bestMultipl }).fill(i)) as BodyPartConstant[];
  }
  private names = [
    "Azaghâl",
    "Balin",
    "Bifur",
    "Blacklock",
    "Bodruith",
    "Bofur",
    "Bombur",
    "Borin",
    "Broadbeam",
    "Dáin",
    "Dís",
    "Dori",
    "Durin",
    "Dwalin",
    "Fangluin",
    "Farin",
    "Fíli",
    "Firebeam",
    "Flói",
    "Forn",
    "Frár",
    "Frerin",
    "Frór",
    "Fundin",
    "Gamil",
    "Gimli",
    "Glóin",
    "Gróin",
    "Grór",
    "Ibun",
    "Ironfist",
    "Khîm",
    "Kíli",
    "Longbeard",
    "Lóni",
    "Mahal",
    "Mîm",
    "Náin",
    "Náli",
    "Nár",
    "Narvi",
    "Naugladur",
    "Nori",
    "Óin",
    "Ori",
    "Stiffbeard",
    "Stonefoot",
    "Telchar",
    "Tharkûn",
    "Thorin",
    "Karl",
    "Thráin",
    "Thrór",
    "Carl"
  ];
  private timeToRecalc = 0;
  public runSpawning() {
    if (this.timeToRecalc > 0) this.timeToRecalc -= 1;
    const spawnOffsets = [1, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
    let i = 0;
    for (const spawnerId in Game.spawns) {
      i += 1;
      i %= spawnOffsets.length;

      const spawner = Game.spawns[spawnerId];

      if (spawner.spawning) continue;

      if ((!this.spawnSchedules[spawnerId] || this.spawnSchedules[spawnerId].length === 0) && this.timeToRecalc === 0) {
        this.updateSpawnSchedules();
        this.timeToRecalc = 15;
        // TODO: link to scheduler instead of raw tick count!!
      }

      let requests = this.spawnSchedules[spawnerId].filter(
        a => (a.plannedTime ?? -1) <= Game.time && (a.plannedTime ?? -1) > 0
      );

      if ( this.timeToRecalc === 0) {
        this.updateSpawnSchedules();
        this.timeToRecalc = 15;
        requests = this.spawnSchedules[spawnerId].filter(
          a => (a.plannedTime ?? -1) <= Game.time && (a.plannedTime ?? -1) > -1
        );
        // TODO: link to scheduler instead of raw tick count!!
      }

      requests.sort((a, b) => {
        const condition = (aa: SpawnRequest, bb: SpawnRequest) =>
          aa.urgency > bb.urgency || (aa.urgency === bb.urgency && (aa.priority ?? 0) > (bb.priority ?? 0));
        if (condition(a, b)) return -1;
        if (condition(b, a)) return 1;
        return 0;
      });

      g.hud.makeElement(`spawner ${spawnerId}`, spawner.pos, undefined, undefined, {scale:"medium"})
      for(const r of this.spawnSchedules[spawnerId]){
        g.hud.addText(`spawner ${spawnerId}`, `${r.suffix} urg:${r.urgency} t:${(r.plannedTime ?? Game.time)-Game.time}`)
      }
      g.hud.addText(`spawner ${spawnerId}`, 'break')
      for(const r of requests){
        g.hud.addText(`spawner ${spawnerId}`, `${r.suffix} urg:${r.urgency} t:${(r.plannedTime ?? Game.time)-Game.time}`)
      }

      let k = 0;
      while (k < requests.length) {
        const body = this.getCreepBuildArray(requests[k], spawner.room.energyAvailable);
        if (body.length === 0 || (requests[k].urgency<=SpawnUrgency.needed && body.length < this.getCreepBuildArray(requests[k], spawner.room.energyCapacityAvailable).length)) {
          k++;
          continue;
        }
        const firstIndex = Math.floor(
          ((Game.time * spawnOffsets[i]) % (this.names.length * this.names.length)) / this.names.length
        );
        const secondIndex = (Game.time * spawnOffsets[i]) % this.names.length;
        const name = `${this.names[secondIndex]} ${this.names[firstIndex]}-${requests[k].suffix}`;

        const res = spawner.spawnCreep(body, name);
        if (res === OK) {
          const requ = requests[k];
          const requI = this.spawnSchedules[spawnerId].findIndex(
            a =>
              a.urgency === requ.urgency &&
              a.room === requ.room &&
              a.suffix === requ.suffix &&
              a.time === requ.time &&
              String(a.bodyOptions) === String(requ.bodyOptions)
          );
          if (requI === -1) console.log("muster lost the plot");
          else this.spawnSchedules[spawnerId].splice(requI, 1);
        } else {
          g.hud.makeElement(`${spawnerId}`, spawner.pos, [`err: ${res}`]);
        }
        break;
      }
    }
    /* for(const spawnerId in Game.spawns){
        const spawner = Game.spawns[spawnerId]
        if(spawner.spawning) continue
        const energy = spawner.room.energyAvailable;
        const energyCap = spawner.room.energyCapacityAvailable;

        const protectedRoom = Game.rooms[Game.flags.found?.pos.roomName]
        const protectors = _.filter(states, entity => entity.type == "creep" && entity.role == "drain");
        if(protectedRoom && protectedRoom.find(FIND_HOSTILE_CREEPS).length>0 && protectors.length<1){
            const partList = [ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE]
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-d";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
            continue
        }

        const raiders = _.filter(states, entity => entity.type == "creep" && ( entity.role == "irritant"));
        if (energy >= energyCap-100 && raiders.length < 1 && false && [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].includes(Game.time%1600) ) {
            const partList = [TOUGH,TOUGH,MOVE,MOVE,MOVE,HEAL]// [TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL]
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-i";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
        }

        const workers = _.filter(states, entity => entity.type == "creep" && entity.role == "worker");
        const workerNum = workers.length;
        const creepCost = 200.0; // one move, one work, one carry
        if (workerNum < 5 &&
            !spawner.spawning &&
            energy >= 200 &&
            (workerNum < 1 || energy >= energyCap - (energyCap % creepCost) || energy > 2000)) {
            const partList = [];
            const partNum = energy / creepCost;
            let i = 1;
            while (i <= partNum && partList.length < 48) {
                partList.unshift(WORK);
                partList.push(CARRY);
                partList.push(MOVE);
                i++;
            }
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-w";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
            continue
        }
        const mobileHarvesters = _.filter(states, entity => entity.type == "creep" && entity.role == "mobileHarvester");
        let mhCost = 600;
        let mhPartList = [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE];
        if (energyCap<600) {
            mhCost = 500;
            mhPartList = [WORK, WORK, WORK, WORK, MOVE, MOVE];
        }
        if (mobileHarvesters.length < 2 || energyCap<500) {
            mhCost = 350;
            mhPartList = [WORK, WORK, WORK, MOVE];
        }
        if (mobileHarvesters.length < 1 || energyCap<350) {
            mhCost = 250;
            mhPartList = [WORK, WORK, MOVE];
        }
        if (energy >= mhCost && mobileHarvesters.length < 5) {
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-md";
            spawner.spawnCreep(mhPartList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
            continue
        }
        const haulers = _.filter(states, entity => entity.type == "creep" && entity.role == "hauler");
        if ((haulers.length < 8 && energy > energyCap / 1.5) || (haulers.length < 1 && energy >= creepCost)) {
            const partList = [];
            const partNum = energy / creepCost;
            let i = 1;
            while (i <= partNum && i < 10) {
                partList.unshift(CARRY);
                partList.unshift(CARRY);
                partList.push(MOVE);
                i++;
            }
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-h";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
            continue
        }
        const combatants = _.filter(states, entity => entity.type == "creep" && (entity.role == "drainDISABLE" || entity.role == "poke"));
        if ((combatants.length < 3*energy/energyCap) || (energy >= energyCap && Game.time%30==0) ) {
            const partList = [MOVE]; // [TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL]
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-p";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
        }
        const pioneers = _.filter(states, entity => entity.type == "creep" && (entity.role == "pioneer"));
        const pioneerRequests = _.filter(jobs, job => job.type == "found");
        if (pioneers.length < 1 && pioneerRequests.length > 0) {
            const partList = [MOVE, CLAIM];
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-pio";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
        }
        const attackers = _.filter(states, entity => entity.type == "creep" && (entity.role == "attacker"));
        if (attackers.length < 1 && raiders.length >= 3 && false) {
            const partList = [ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL]
            const creepName = names[Math.round(Game.time / 20) % names.length] + (Game.time % 20) + "-a";
            spawner.spawnCreep(partList, creepName);
            global.scheduler.stateUpdate++;
            global.scheduler.jobRest++;
        }
    }*/
  }
}

const muster = new Muster();
export { muster };
export type { SpawnRequest, SpawnUrgency };
