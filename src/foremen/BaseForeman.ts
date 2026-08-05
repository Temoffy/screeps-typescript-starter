/* eslint-disable @typescript-eslint/prefer-for-of */
/* eslint-disable no-underscore-dangle */
/* eslint-disable max-classes-per-file */

// BaseForeman.ts

import { Job, JobBoard, MY_NUMS } from "JobBoard";
import { Evaluation, Task, econTasks } from "econTasks";
import { Tools } from "utils/Tools";
import { SpawnRequest, SpawnUrgency } from "muster/muster";

interface Dwarf {
  readonly id: Id<Creep>;
  readonly role: string;
  commands: Command[];
  info: {
    remove: boolean;
    workParts: number;
    carryParts: number;
    spawnCost: number;
    cargo: SimpleStore;
    working: boolean;
  };
}
interface Command {
  readonly type: string;
  target: Id<AnyStructure | ConstructionSite | Creep | Source | Mineral | Resource | Tombstone | Ruin>;
  pos: Pos;
  amount: number;
  readonly jobId?: number;
  readonly resourceType: ResourceConstant;
}

abstract class BaseForeman {
  protected dwarves: Dwarf[] = [];
  protected _memberTypes: { [key: string]: string } = {};
  // protects name during rollup, for Prioritizer purposes.
  protected abstract foremanName: string;

  public get memberTypes(): string[] {
    return Object.keys(this._memberTypes);
  }
  public get memberIDs(): Id<Creep>[] {
    return this.dwarves.map(dwarf => dwarf.id);
  }
  public get name(): string {
    return this.foremanName;
  }
  public abstract run(): void;
  public abstract assignCreep(creep: Creep, role: string): boolean;
  public abstract update(): number;
  public abstract getSpawnRequests(): SpawnRequest[];
}

export type { Dwarf, Command };
export { BaseForeman };
