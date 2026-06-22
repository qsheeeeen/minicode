export function callContent(
  name: string,
  input: Record<string, unknown>,
): string {
  // Optional params render only when explicitly set: unset optionals are
  // omitted, and a set `0`/`false` still shows (guarded by `!== undefined`).
  const opt = (key: string): string | undefined => {
    const v = input[key];
    return v === undefined ? undefined : `${key}: ${JSON.stringify(v)}`;
  };
  const opts = (keys: string[]): string[] =>
    keys.map(opt).filter((s): s is string => s !== undefined);

  switch (name) {
    case "Read":
      return `Read(${[input.path as string, ...opts(["offset", "limit"])].join(", ")})`;
    case "Write": {
      const content = input.content as string;
      const lines = content ? content.split("\n").length : 0;
      return `Write(${input.path as string}, ${lines} lines)`;
    }
    case "Edit":
      return `Edit(${[input.path as string, ...opts(["replaceAll"])].join(", ")})`;
    case "Shell":
      return `Shell(${[input.command as string, ...opts(["timeout"])].join(", ")})`;
    case "SubAgent": {
      const task = input.task as string;
      const preview = task.length > 30 ? task.slice(0, 30) + "..." : task;
      return `SubAgent(${[preview, ...opts(["tier"])].join(", ")})`;
    }
    case "LoadSkill":
      return `LoadSkill(${input.name as string})`;
    case "AskUser":
      return `AskUser(${[`"${input.question as string}"`, ...opts(["multiSelect"])].join(", ")})`;
    case "Grep":
      return `Grep(${[
        input.pattern as string,
        ...opts(["path", "recursive", "ignore_case", "include"]),
      ].join(", ")})`;
    default:
      throw new Error(
        `callContent: no formatter implemented for tool "${name}". Add a case in src/utils/tool-format.ts.`,
      );
  }
}
