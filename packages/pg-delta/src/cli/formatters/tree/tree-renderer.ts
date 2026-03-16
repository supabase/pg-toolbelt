/**
 * Generic tree renderer for hierarchical structures.
 * Uses dim guides and connectors (├/└) with no trailing rails past last children.
 * Helper names favor readability over brevity.
 */

import { type AnsiPalette, createAnsiPalette } from "../../ansi.ts";

const GUIDE_UNIT = "│  ";
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");
const visibleWidth = (value: string) => stripAnsi(value).length;
const splitNameCount = (name: string) => {
  const match = name.match(/^(.*?)(\s+)(\d+)$/);
  return match
    ? { base: match[1], sep: match[2], count: match[3] }
    : { base: name, sep: "", count: "" };
};
const GROUP_NAMES = [
  "cluster",
  "database",
  "schemas",
  "tables",
  "views",
  "materialized views",
  "functions",
  "procedures",
  "aggregates",
  "sequences",
  "types",
  "enums",
  "composite types",
  "ranges",
  "domains",
  "collations",
  "foreign tables",
  "columns",
  "indexes",
  "triggers",
  "rules",
  "policies",
  "partitions",
  "roles",
  "extensions",
  "event triggers",
  "publications",
  "subscriptions",
  "foreign data wrappers",
  "servers",
  "user mappings",
];

interface OperationCounts {
  create: number;
  alter: number;
  drop: number;
}

/**
 * Increment operation counters based on a prefixed label.
 */
function tallyOperation(name: string, counts: OperationCounts): void {
  if (name.startsWith("+")) counts.create += 1;
  else if (name.startsWith("~")) counts.alter += 1;
  else if (name.startsWith("-")) counts.drop += 1;
}

/**
 * Count operations for a single level (no recursion).
 */
function summarizeShallow(
  groups?: TreeGroup[],
  items?: TreeItem[],
): OperationCounts {
  const counts: OperationCounts = { create: 0, alter: 0, drop: 0 };

  if (items) {
    for (const item of items) {
      tallyOperation(item.name, counts);
    }
  }
  if (groups) {
    for (const group of groups) {
      tallyOperation(group.name, counts);
    }
  }

  return counts;
}

export interface TreeItem {
  name: string;
}

export interface TreeGroup {
  name: string;
  items?: TreeItem[];
  groups?: TreeGroup[];
}

/**
 * Render a tree structure using plain lines style.
 *
 * @example
 * ```ts
 * const tree: TreeGroup = {
 *   name: "root",
 *   groups: [
 *     { name: "src", items: [{ name: "index.ts" }] },
 *     { name: "tests", items: [{ name: "test.ts" }] },
 *   ],
 * };
 * const output = renderTree(tree);
 * // Output:
 * // root
 * // ├─ src
 * // │  └─ index.ts
 * // └─ tests
 * //    └─ test.ts
 * ```
 */
export function renderTree(root: TreeGroup, useColors = true): string {
  const palette = createAnsiPalette(useColors);

  interface TreeRow {
    left: string;
    counts?: OperationCounts;
  }

  const rows: TreeRow[] = [];
  if (root.name) {
    rows.push({ left: palette.bold(root.name) });
  }

  const rootItems = root.items ?? [];
  const rootGroups = root.groups ?? [];

  // Render root groups at top level (no extra wrapper indentation)
  const clusterEntries: TreeGroup[] = [];
  const otherGroups: TreeGroup[] = [];
  let schemasGroup: TreeGroup | undefined;

  for (const group of rootGroups) {
    const { base: label } = splitNameCount(group.name);
    if (label === "cluster") {
      if (group.items) {
        clusterEntries.push(
          ...group.items.map((item) => ({ name: item.name })),
        );
      }
      if (group.groups) {
        clusterEntries.push(...group.groups);
      }
    } else if (label === "schemas") {
      schemasGroup = group;
    } else {
      otherGroups.push(group);
    }
  }

  const orderedRoot: TreeGroup[] = [
    ...sortGroups(clusterEntries),
    ...(schemasGroup ? [schemasGroup] : []),
    ...sortGroups(otherGroups),
  ];

  const combinedRoot = [
    ...sortItems(rootItems).map((item) => ({
      kind: "item" as const,
      name: item.name,
    })),
    ...orderedRoot.map((group) => ({ kind: "group" as const, group })),
  ];

  for (let index = 0; index < combinedRoot.length; index += 1) {
    const node = combinedRoot[index];
    const isLast = index === combinedRoot.length - 1;
    if (node.kind === "item") {
      renderItem(node.name, [], isLast, rows, palette);
    } else {
      renderGroup(node.group, [], isLast, rows, palette);
    }
  }

  const maxLeftWidth = rows.reduce(
    (max, row) => Math.max(max, visibleWidth(row.left)),
    0,
  );

  return rows
    .map(({ left, counts }) => {
      if (!counts) return left;

      const parts: string[] = [];
      if (counts.create) parts.push(palette.greenDim(`+${counts.create}`));
      if (counts.alter) parts.push(palette.yellowDim(`~${counts.alter}`));
      if (counts.drop) parts.push(palette.redDim(`-${counts.drop}`));

      if (parts.length === 0) return left;

      const summary = parts.join(" ");
      const gap = Math.max(
        1,
        maxLeftWidth - visibleWidth(left) - visibleWidth(summary) - 1,
      );
      const filler = gap > 0 ? " ".repeat(gap) : "";

      return `${left}${filler} ${summary}`;
    })
    .join("\n");
}

function sortItems(items: TreeItem[]): TreeItem[] {
  return [...items].sort((left, right) => {
    const operationOrder = (name: string) =>
      name.startsWith("+")
        ? 0
        : name.startsWith("~")
          ? 1
          : name.startsWith("-")
            ? 2
            : 3;

    const leftOrder = operationOrder(left.name);
    const rightOrder = operationOrder(right.name);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftLabel = left.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const rightLabel = right.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (leftLabel < rightLabel) return -1;
    if (leftLabel > rightLabel) return 1;
    return 0;
  });
}

function sortGroups(groups: TreeGroup[]): TreeGroup[] {
  return [...groups].sort((left, right) => {
    const operationOrder = (name: string) =>
      name.startsWith("+")
        ? 0
        : name.startsWith("~")
          ? 1
          : name.startsWith("-")
            ? 2
            : 3;

    const leftOrder = operationOrder(left.name);
    const rightOrder = operationOrder(right.name);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftLabel = left.name.replace(/^[+~-]\s*/, "").toLowerCase();
    const rightLabel = right.name.replace(/^[+~-]\s*/, "").toLowerCase();
    if (leftLabel < rightLabel) return -1;
    if (leftLabel > rightLabel) return 1;
    return 0;
  });
}

/**
 * Colorize a label; pads non-op labels to align with op-labeled rows.
 */
function colorizeName(
  name: string,
  palette: AnsiPalette,
  isGroup = false,
): string {
  const { base: rawBase, sep, count } = splitNameCount(name);
  const hasOperationSymbol = /^[+~-]\s/.test(rawBase);
  const baseName = rawBase.trim();

  // Colorize items/entities with operation symbols (e.g., "+ customer", "+ customer_email_domain_idx")
  if (hasOperationSymbol) {
    const symbol = rawBase[0];
    const rest = rawBase.slice(2).trimStart();
    const coloredBase =
      symbol === "+"
        ? `${palette.green(symbol)} ${rest}`
        : symbol === "~"
          ? `${palette.yellow(symbol)} ${rest}`
          : `${palette.red(symbol)} ${rest}`;

    return count ? `${coloredBase}${sep}${palette.gray(count)}` : coloredBase;
  }

  // Group names (like "tables", "schemas") - dim gray
  const baseNameStripped = baseName.replace(/\s*\(\d+\)$/, "");
  if (GROUP_NAMES.includes(baseNameStripped)) {
    const coloredBase = palette.gray(baseNameStripped);
    return count ? `${coloredBase}${sep}${palette.gray(count)}` : coloredBase;
  }

  const padded = isGroup ? baseName : `  ${baseName}`;
  return count ? `${padded}${sep}${palette.gray(count)}` : padded;
}

/**
 * Render a group with bullet-style indentation.
 */
function buildPrefix(ancestors: boolean[], palette: AnsiPalette): string {
  return ancestors
    .map((hasSibling) => (hasSibling ? palette.guide(GUIDE_UNIT) : "   "))
    .join("");
}

/**
 * Render a group node (may have child groups/items). Avoids drawing guides past the last child.
 */
function renderGroup(
  group: TreeGroup,
  ancestors: boolean[],
  isLast: boolean,
  rows: { left: string; counts?: OperationCounts }[],
  palette: AnsiPalette,
): void {
  const { base } = splitNameCount(group.name);
  const hasOperationSymbol = /^[+~-]\s/.test(base);
  const baseNormalized = base
    .replace(/^[+~-]\s*/, "")
    .replace(/\s*\(\d+\)$/, "");
  const summary =
    GROUP_NAMES.includes(base) &&
    baseNormalized !== "types" &&
    (group.items || group.groups)
      ? summarizeShallow(group.groups, group.items)
      : undefined;

  const childItems = sortItems(group.items ?? []);
  const childGroups = sortGroups(group.groups ?? []);
  const children = [
    ...childItems.map((item) => ({ kind: "item" as const, name: item.name })),
    ...childGroups.map((childGroup) => ({
      kind: "group" as const,
      group: childGroup,
    })),
  ];

  const prefix = buildPrefix(ancestors, palette);
  const connector = palette.guide(isLast ? "└ " : "├ ");
  const extraGuide = hasOperationSymbol ? "" : connector;
  rows.push({
    left: `${prefix}${extraGuide}${colorizeName(base, palette, true)}`,
    counts: summary,
  });

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childIsLast = index === children.length - 1;
    const childAncestors = [...ancestors, !isLast];
    if (child.kind === "item") {
      renderItem(child.name, childAncestors, childIsLast, rows, palette);
    } else {
      renderGroup(child.group, childAncestors, childIsLast, rows, palette);
    }
  }
}

/**
 * Render a leaf item. Non-op rows get a dim connector; op rows start at the prefix.
 */
function renderItem(
  name: string,
  ancestors: boolean[],
  isLast: boolean,
  rows: { left: string; counts?: OperationCounts }[],
  palette: AnsiPalette,
): void {
  const prefix = buildPrefix(ancestors, palette);
  const hasOperationSymbol = /^[+~-]\s/.test(name);
  const connector = hasOperationSymbol
    ? ""
    : palette.guide(isLast ? "└ " : "├ ");
  rows.push({
    left: `${prefix}${connector}${colorizeName(name, palette)}`,
  });
}
