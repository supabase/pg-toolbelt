export const splitTopLevel = (value: string, separator: string): string[] => {
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1];
    if (!char) {
      continue;
    }

    if (char === '"') {
      buffer += char;
      if (inQuotes && nextChar === '"') {
        buffer += nextChar;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && char === separator) {
        result.push(buffer.trim());
        buffer = "";
        continue;
      }
    }

    buffer += char;
  }

  result.push(buffer.trim());
  return result.filter((part) => part.length > 0);
};
