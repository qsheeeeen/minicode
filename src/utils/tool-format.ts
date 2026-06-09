function summary(input: Record<string, unknown>): string {
  return JSON.stringify(input);
}

export function callContent(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "Read": {
      const path = input.path as string;
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      const parts = [path];
      if (offset) parts.push(`offset: ${offset}`);
      if (limit) parts.push(`limit: ${limit}`);
      return `${name}(${parts.join(", ")})`;
    }
    case "Write": {
      const path = input.path as string;
      const content = input.content as string;
      const lines = content ? content.split("\n").length : 0;
      return `${name}(${path}, ${lines} lines)`;
    }
    case "Edit": {
      return `${name}(${input.path as string})`;
    }
    case "Bash": {
      return `${name}(${input.command as string})`;
    }
    case "SubAgent": {
      const task = input.task as string;
      const preview = task.length > 30 ? task.slice(0, 30) + "..." : task;
      return `${name}(${preview})`;
    }
    case "LoadSkill": {
      return `${name}(${input.name as string})`;
    }
    case "AskUser": {
      return `${name}("${input.question as string}")`;
    }
    case "SetModel": {
      const tier = input.tier as string;
      return `${name}(${tier.charAt(0).toUpperCase() + tier.slice(1)})`;
    }
    default:
      return `${name}(${summary(input)})`;
  }
}
