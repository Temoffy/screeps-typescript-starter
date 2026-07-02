interface Todo {
    readonly name: string;
    readonly func: () => number;
    readonly priority: number;
    readonly ogInterval: number;
    interval: number;
    score: number;
    cpuCost: number;
    lastExecuted: number;
}

// maximise score per cpu, where score is priority*number returned from func (qualitatively, how much it achieved).
class Prioritizer {
    private scheduled: Todo[] = [];
    private avePercentile = 0.7; // not exact, actual is higher. close 'nuff.
    private cpuLimit = Game.cpu.limit || 20;
    private convergence = 1/50;

    private lastBucket = Game.cpu.bucket;

    private runCount = 0;

    public schedule(func: () => number, name: string, priority: number, interval: number) {
        if(this.scheduled.find(s => s.name === name)) {
            console.log(`Task with name ${name} already scheduled!!!`);
            console.log(`Prioritizer mem read/write compromised!!`);
            console.log(`Prioritizer request specific compromised!!`);
        };
        this.scheduled.push({ func, score: 1, priority, cpuCost: 0.1, interval, ogInterval: interval, lastExecuted: 0, name });
    }
    private execute(todo: Todo): number {
        const cpuBefore = Game.cpu.getUsed();
        const newScore = todo.func();
        const cpuAfter = Game.cpu.getUsed();
        const newCpuCost = cpuAfter - cpuBefore;

        let scoreDelta = todo.score - newScore;
        if(scoreDelta < 0) scoreDelta = scoreDelta*(1-this.avePercentile);
        todo.score += scoreDelta*this.convergence;

        let cpuDelta = todo.cpuCost - newCpuCost;
        if(cpuDelta < 0) cpuDelta = cpuDelta*(1-this.avePercentile);
        todo.cpuCost += cpuDelta*this.convergence;

        todo.lastExecuted = Game.time;
        return cpuAfter;
    }
    private refineInterval(){
        const sum = _.sum(this.scheduled, s => s.score/s.cpuCost);
        const ave = sum/this.scheduled.length;

        for(const todo of this.scheduled){
            const difference = ave - (todo.score/todo.cpuCost);
            todo.interval = Math.max(todo.ogInterval/4, Math.min(todo.interval*(1 + difference*this.convergence), todo.ogInterval*4));
        }
    }
    private refineCpuLimit(){
        let deltaBucket = (Game.cpu.bucket - this.lastBucket);
        if(deltaBucket > 0) deltaBucket = deltaBucket*(1-this.avePercentile);
        this.cpuLimit += deltaBucket*this.convergence;

        this.cpuLimit = Math.max(Game.cpu.limit/20, Math.min(this.cpuLimit, Game.cpu.limit));

        if(Game.cpu.bucket === 10000 && Game.shard.name === "shard3"){
            Game.cpu.generatePixel();
        }

        this.lastBucket = Game.cpu.bucket;
    }
    public run() {
        // square the interval ratio to dominate scoring.
        const scoring = (s: Todo) => (s.score*s.priority*Math.pow((Game.time-s.lastExecuted), 2)) / (s.cpuCost*Math.pow(s.interval, 2));
        this.scheduled.sort((a, b) => scoring(b) - scoring(a));
        let cpuUsed = Game.cpu.getUsed();
        let i = 0;
        // after getting more concrete data on costs and score, should probably replace runnableThreshold with a min score or similar.
        const runnableThreshold = 0.7;
        while(cpuUsed + this.scheduled[i]?.cpuCost < this.cpuLimit && i < this.scheduled.length && this.scheduled[i].interval * runnableThreshold < Game.time - this.scheduled[i].lastExecuted){
            const todo = this.scheduled[i];
            cpuUsed = this.execute(todo);
            i++;
            this.runCount++;
        }
        // will vary in how often this runs
        if(this.runCount>this.scheduled.length*3){
            this.refineInterval();
            this.runCount = 0;
        }
        this.refineCpuLimit();
    }
    // WILL warp typical execution interval, use sparingly!
    // ie: scout entering new room, want to immediately update atlas.
    public requestSpecific(name: string, insistance = 1): boolean {
        const todo = this.scheduled.find(s => s.name === name);
        if(!todo) {
            console.log(`Task with name ${name} not found!!!`);
            return false;
        }
        todo.lastExecuted -= insistance;
        return true;
    }
    // orphan objects possible, clean mem if changing tasks
    public writeMem(){
        Memory.prioritizer = {
            scheduled: this.scheduled.map(s => ({name: s.name, score: s.score, cpuCost: s.cpuCost, interval: s.interval})),
            cpuLimit: this.cpuLimit
        }
    }
    public readMem(){
        const mem = Memory.prioritizer;
        if(!mem) return;
        this.cpuLimit = mem.cpuLimit;
        for(const memTodo of mem.scheduled){
            const todo = this.scheduled.find(s => s.name == memTodo.name);
            if(!todo) continue;
            todo.score = memTodo.score;
            todo.cpuCost = memTodo.cpuCost;
            todo.interval = memTodo.interval;
        }
    }
}
export {Prioritizer};
