import { Page } from "playwright";
import { AgentState } from "./types";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { PROMPT } from "./consts";

export class Agent {
  public state: AgentState;
  private openaiClient: OpenAI;
  constructor(taskDescription: string, page: Page) {
    this.openaiClient = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
    });

    this.state = {
      page,
      bboxes: [],
      scratchpad: [],
      input: {
        input: taskDescription,
      },
    };
  }

  async nextAction() {
    console.log("State before action...");
    this.logState();

    // Annotate the current page and update the screenshot and bounding boxes
    await this.annotate(10, 3000);

    // Update the bounding box descriptions
    this.formatBoundingBoxDescriptions();

    // Prompt the LLM
    await this.prompt();

    console.log("\n\nState after action...");
    this.logState();
  }

  async performAction() {
    this.state.prediction.action;
  }

  logState() {
    console.log("Current Agent State:");
    console.log("Page URL:", this.state.page.url());
    console.log(
      "Input Description:",
      this.state.input?.input || "No input provided"
    );
    console.log(
      "Bounding Box Descriptions:",
      this.state.input?.bboxDescriptions || "No bounding box descriptions"
    );
    console.log("Number of Bounding Boxes:", this.state.bboxes.length);
    console.log(
      "Scratchpad Contents:",
      this.state.scratchpad.join(", ") || "Scratchpad is empty"
    );
    console.log(
      "Observation:",
      this.state.observation || "No observation available"
    );
    console.log(
      "Prediction:",
      this.state.prediction
        ? JSON.stringify(this.state.prediction)
        : "No prediction made"
    );
  }

  async prompt() {
    const response = await this.openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "developer",
          content: PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${this.state.input.bboxDescriptions}\n${this.state.input.input}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${this.state.input.img}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
    });
    const output = response.choices[0].message.content;
    console.log("Raw model output: ", output);
    this.parsePrediction(output);
  }

  async annotate(retries: number, delay: number) {
    const scriptPath = path.resolve(__dirname, "../mark-page.js");
    const scriptContent = fs.readFileSync(scriptPath, "utf8");

    // Evaluate the script content directly
    await this.state.page.evaluate(scriptContent);

    let bboxes;
    for (let i = 0; i < retries; i++) {
      try {
        // Call the markPage function defined in the script
        bboxes = await this.state.page.evaluate("markPage()");
        break;
      } catch (error) {
        // May be loading...
        console.warn("Error during markPage evaluation:", error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const screenshot = await this.state.page.screenshot();
    await this.state.page.evaluate("unmarkPage()");

    this.state.input.img = screenshot.toString("base64");
    this.state.bboxes = bboxes;
  }

  formatBoundingBoxDescriptions() {
    const labels = this.state.bboxes.map((bbox, i) => {
      let text = bbox.ariaLabel || "";
      if (!text.trim()) {
        text = bbox.text;
      }
      const elType = bbox.type;
      return `${i} (<${elType}/>): "${text}"`;
    });
    this.state.input.bboxDescriptions =
      "\nValid Bounding Boxes:\n" + labels.join("\n");
  }

  parsePrediction(modelOutput: string) {
    const actionPrefix = "Action: ";
    if (!modelOutput.trim().split("\n").pop().startsWith(actionPrefix)) {
      return {
        action: "TERMINATE",
        args: `Could not parse LLM Output: ${modelOutput}`,
      };
    }
    const actionBlock = modelOutput.trim().split("\n").pop();

    const actionStr = actionBlock.slice(actionPrefix.length);
    const [action, ...rest] = actionStr.split(" ");
    const args = rest
      .join(" ")
      .split(";")
      .map((arg) => arg.trim());

    this.state.prediction = { action: action.trim(), args };
  }

  async click() {
    const page = this.state.page;
    const clickArgs = this.state.prediction.args;
    if (!clickArgs || clickArgs.length !== 1) {
      this.state.observation = `Failed to click bounding box labeled as number ${clickArgs}`;
      return;
    }
    const bboxId = parseInt(clickArgs[0], 10);
    try {
      const bbox = this.state.bboxes[bboxId];
      const { x, y } = bbox;
      await page.mouse.click(x, y);
    } catch (error) {
      this.state.observation = `Error: no bbox for : ${bboxId}`;
      return;
    }
    this.state.observation = `Clicked ${bboxId}`;
  }

  async type() {
    const page = this.state.page;
    const typeArgs = this.state.prediction?.args;
    if (!typeArgs || typeArgs.length !== 2) {
      this.state.observation = `Failed to type in element from bounding box labeled as number ${typeArgs}`;
      return;
    }
    const bboxId = parseInt(typeArgs[0], 10);
    const bbox = this.state.bboxes[bboxId];
    const { x, y } = bbox;
    const textContent = typeArgs[1];
    await page.mouse.click(x, y);
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(textContent);
    await page.keyboard.press("Enter");
    this.state.observation = `Typed ${textContent} and submitted`;
  }

  async scroll() {
    const page = this.state.page;
    const scrollArgs = this.state.prediction?.args;
    if (!scrollArgs || scrollArgs.length !== 2) {
      this.state.observation = "Failed to scroll due to incorrect arguments.";
      return;
    }

    const [target, direction] = scrollArgs;

    if (target.toUpperCase() === "WINDOW") {
      const scrollAmount = 500;
      const scrollDirection =
        direction.toLowerCase() === "up" ? -scrollAmount : scrollAmount;
      await page.evaluate(`window.scrollBy(0, ${scrollDirection})`);
    } else {
      const scrollAmount = 200;
      const targetId = parseInt(target, 10);
      const bbox = this.state.bboxes[targetId];
      const { x, y } = bbox;
      const scrollDirection =
        direction.toLowerCase() === "up" ? -scrollAmount : scrollAmount;
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, scrollDirection);
    }

    this.state.observation = `Scrolled ${direction} in ${
      target.toUpperCase() === "WINDOW" ? "window" : "element"
    }`;
  }

  async wait() {
    const sleep_time = 5;
    await new Promise((resolve) => setTimeout(resolve, sleep_time * 1000));
    this.state.observation = `Waited for ${sleep_time}s.`;
  }

  async goBack() {
    const page = this.state.page;
    await page.goBack();
    this.state.observation = `Navigated back a page to ${page.url()}.`;
  }
}
