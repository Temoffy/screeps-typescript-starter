interface HudStyling {
  line?: boolean;
  scale?: "small" | "medium" | "large";
}
interface HudElement {
  key: string;
  origin: Pos;
  text?: string[];
  secondaryPoints?: Pos[];
  styling?: HudStyling;
}

class Hud {
  private colors = [
    "#bc62b2",
    "#454ca9",
    "#e69999",
    "#b72d3c",
    "#5c95e6",
    "#802a96",
    "#7e57e5",
    "#dab3dd",
    "#54215f",
    "#e67553",
    "#7fee4c",
    "#e33fdf",
    "#282194",
    "#b5b84f",
    "#6ac5df",
    "#76302b",
    "#c63e74",
    "#bf80e6",
    "#372dd2",
    "#7aebe0",
    "#987042",
    "#5172b0",
    "#e76995",
    "#1e1b60",
    "#62cd52",
    "#e0c49b",
    "#b035aa",
    "#985c82",
    "#b0989e",
    "#d0f15f",
    "#9a32dd",
    "#e9d3e3",
    "#822654",
    "#ec414e",
    "#6ba843",
    "#e1a25d",
    "#3b1131",
    "#e695e3",
    "#3c52e4",
    "#9fa5e3",
    "#8d81ac",
    "#b18e50",
    "#324174",
    "#7bea99",
    "#5dbb92",
    "#ea3ea4",
    "#6f34d3",
    "#944b43",
    "#dfd25d",
    "#4a8fa0",
    "#6a4a78",
    "#58813e",
    "#b8727c",
    "#562a96",
    "#5b1e2c",
    "#9279e6",
    "#bb4ee5",
    "#7e56b0",
    "#e96de1",
    "#62abc6",
    "#c65837",
    "#190c37",
    "#4976e6",
    "#d7eddb",
    "#a12e79",
    "#accfdc",
    "#376188",
    "#695722",
    "#abb4a6",
    "#cc84b8"
  ];
  private hudElements: HudElement[] = [];

  public makeElement(
    key: string,
    origin: Pos,
    text?: string[] | string,
    secondaryPoints?: Pos[] | Pos,
    styling?: HudStyling
  ) {
    if (typeof text === "string") text = [text];
    if (secondaryPoints && !Array.isArray(secondaryPoints)) secondaryPoints = [secondaryPoints];

    const element: HudElement = { key, origin, text, secondaryPoints, styling };

    if (this.hudElements.some(e => e.key === element.key)) {
      const oldEntry = this.hudElements.find(e => e.key === element.key);
      if (origin !== oldEntry?.origin) {
        console.log(`Hud key collision! ${JSON.stringify(oldEntry)} collided with ${JSON.stringify(element)}`);
        return;
      }

      if (text) {
        if (!oldEntry?.text) oldEntry.text = [];
        oldEntry.text = oldEntry.text.concat(text);
      }
      if (secondaryPoints) {
        if (!oldEntry?.secondaryPoints) oldEntry.secondaryPoints = [];
        oldEntry.secondaryPoints = oldEntry.secondaryPoints.concat(secondaryPoints);
      }
      return;
    }
    this.hudElements.push(element);
  }

  public addText(key: string, text: string) {
    const element = this.hudElements.find(e => e.key === key);
    if (element) {
      if (!element.text) element.text = [];
      element.text.push(text);
      return;
    }
    console.log(`Hud can't find key: "${key}" for text addition: ${text}`);
  }

  public addSecondaryPoint(key: string, point: Pos) {
    const element = this.hudElements.find(e => e.key === key);
    if (element) {
      if (!element.secondaryPoints) element.secondaryPoints = [];
      element.secondaryPoints.push(point);
      return;
    }
    console.log(`Hud can't find key: "${key}" for secondary point addition: ${JSON.stringify(point)}`);
  }

  public display() {
    for (let i = this.hudElements.length - 1; i >= 0; i--) {
      const element = this.hudElements[i];
      const color = this.colors[i % this.colors.length];
      const { key, origin, text, secondaryPoints, styling } = element;

      let linewidth = 0.5;
      let fontScale = 0.45;
      switch (styling?.scale) {
        case "small":
          linewidth = 0.22;
          fontScale = 0.2;
          break;
        case "medium":
          break;
        case "large":
          linewidth = 0.8;
          fontScale = 0.7;
          break;
      }

      const roomVis = new RoomVisual(origin.roomName);
      if (text) {
        let yOffset = (Math.random() - 0.5) / 3;
        for (const line of text) {
          roomVis.text(line, origin.x, origin.y + yOffset, {
            font: `bold ${fontScale} monospace`,
            color,
            align: "left",
            stroke: "#000000",
            strokeWidth: 0.08
          });
          yOffset += linewidth;
        }
      } else {
        roomVis.circle(origin.x, origin.y, { fill: color, stroke: "#000000" });
      }

      if (styling?.line) {
        let oldPoint = origin;
        for (const point of secondaryPoints || []) {
          if (point.roomName !== oldPoint.roomName) continue;

          const pointVis = new RoomVisual(oldPoint.roomName);
          pointVis.line(oldPoint.x, oldPoint.y, point.x, point.y, { color });
          oldPoint = point;
        }
      } else {
        for (const point of secondaryPoints || []) {
          const pointVis = new RoomVisual(point.roomName);
          pointVis.circle(point.x, point.y, { fill: color });
        }
      }
    }
    this.hudElements = [];
  }
}

export default Hud;
