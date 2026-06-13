import { registerCommand } from "../registry.js";

registerCommand({
  name: "plan",
  description: "Turn the current discussion into an executable plan",
  prompt: () => {
    return "Based on our discussion so far, produce a concrete, step-by-step executable plan. For each step, specify what to do and how to verify it works. Do NOT start implementing — only output the plan.";
  },
});
