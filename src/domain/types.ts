import { Page } from "playwright";

export interface BBox {
  x: number;
  y: number;
  text: string;
  type: string;
  ariaLabel: string;
}

export interface Prediction {
  action: string;
  args?: string[];
}

export interface AgentState {
  page: Page; // The Playwright web page lets us interact with the web environment
  input?: {
    bboxDescriptions?: string; // For bounding box descriptions
    img?: string; // For base64 encoded images
    input: string; // For user input
  };
  bboxes: BBox[]; // The bounding boxes from the browser annotation function
  prediction?: Prediction; // The Agent's output
  scratchpad: string[]; // A system message (or messages) containing the intermediate steps
  observation?: string; // The most recent response from a tool
}
