class Tools {
  public static DIRECTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
  public static DIRECTION_OFFSETS: { [key: number]: number[] } = {
    1: [0, -1], // TOP
    2: [1, -1], // TOP_RIGHT
    3: [1, 0], // RIGHT
    4: [1, 1], // BOTTOM_RIGHT
    5: [0, 1], // BOTTOM
    6: [-1, 1], // BOTTOM_LEFT
    7: [-1, 0], // LEFT
    8: [-1, -1] // TOP_LEFT
  };
  public static getOffset(coords: Pos, dir: number) {
    const offset = this.DIRECTION_OFFSETS[dir];
    return { x: coords.x + offset[0], y: coords.y + offset[1], roomName: coords.roomName };
  }

  public static maxDistance(pos1: Pos, pos2: Pos) {
    const gpos1 = Tools.getWorldCoord(pos1);
    const gpos2 = Tools.getWorldCoord(pos2);
    const xDiff = Math.abs(gpos1.x - gpos2.x);
    const yDiff = Math.abs(gpos1.y - gpos2.y);
    const maxDistance = Math.max(xDiff, yDiff);
    return maxDistance;
  }

  public static getWorldCoord(pos: Pos) {
    const { x, y, roomName } = pos;
    if (x < 0 || x > 49) throw new RangeError("x value " + x + " not in range");
    if (y < 0 || y > 49) throw new RangeError("y value " + y + " not in range");
    if (roomName == "sim") throw new RangeError("Sim room does not have world position");
    const [name, h, wxs, v, wys] = roomName.match(/^([WE])([0-9]+)([NS])([0-9]+)$/) as RegExpMatchArray;
    let [wx, wy] = [parseInt(wxs), parseInt(wys)];

    if (h === "W") wx = ~wx;
    if (v === "N") wy = ~wy;
    return { x: 50 * wx + x, y: 50 * wy + y };
  }

  public static getRoomNeighbors(roomName: string): string[] {
    const rawNeighbors = Game.map.describeExits(roomName);
    const neighbors: string[] = [];
    for (const dir in rawNeighbors) {
      neighbors.push(rawNeighbors[dir as ExitKey] as string);
    }
    return neighbors;
  }
}
export { Tools };
