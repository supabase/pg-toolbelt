/**
 * Generic tree renderer for hierarchical structures.
 * Uses plain lines style: ├─ and └─
 */

import chalk from "chalk";

const CONNECTOR_MID = "├─";
const CONNECTOR_LAST = "└─";
const VERTICAL = "│";
const INDENT_WITH_CHILD = `${VERTICAL}  `;
const INDENT_LAST = "   ";

/**
 * A single item in the tree (leaf node).
 */
export interface TreeItem {
  /** The display name/label */
  name: string;
}

/**
 * A group in the tree (branch node with children).
 */
export interface TreeGroup {
  /** The display name/label */
  name: string;
  /** Child items (leaves) */
  items?: TreeItem[];
  /** Child groups (branches) */
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
export function renderTree(root: TreeGroup): string {
  const lines: string[] = [];
  if (root.name) {
    lines.push(chalk.bold(root.name));
  }

  const rootItems = root.items ?? [];
  const rootGroups = root.groups ?? [];

  // Render root items (rare)
  for (let i = 0; i < rootItems.length; i++) {
    const item = rootItems[i];
    const isLast = i === rootItems.length - 1 && rootGroups.length === 0;
    const connector = isLast ? CONNECTOR_LAST : CONNECTOR_MID;
    const coloredConnector = colorizeConnector(connector);
    const coloredName = colorizeName(item.name);
    lines.push(`${coloredConnector} ${coloredName}`);
  }

  // Render root groups at top level (no extra wrapper indentation)
  for (let i = 0; i < rootGroups.length; i++) {
    const group = rootGroups[i];
    const baseName = group.name.replace(/\s*\(\d+\)$/, "");
    if (baseName === "cluster" || baseName === "schemas") {
      // Top-level headers rendered without connectors
      lines.push(colorizeName(group.name));
      renderChildren(group.items, group.groups, "", lines);
      // Add a blank line between top-level sections except after the last
      if (i !== rootGroups.length - 1) {
        lines.push("");
      }
    } else {
      const isLast = i === rootGroups.length - 1;
      renderGroup(group, "", isLast, lines);
    }
  }

  return lines.join("\n");
}

/**
 * Colorize a name based on operation symbols (+ ~ -).
 */
function colorizeName(name: string): string {
  // Colorize items/entities with operation symbols (e.g., "+ customer", "+ customer_email_domain_idx")
  if (/^[+~-]\s/.test(name)) {
    const symbol = name[0];
    const rest = name.slice(2);
    if (symbol === "+") return `${chalk.green(symbol)} ${rest}`;
    if (symbol === "~") return `${chalk.yellow(symbol)} ${rest}`;
    if (symbol === "-") return `${chalk.red(symbol)} ${rest}`;
  }

  // Group names (like "tables", "schemas") - dim gray
  const baseName = name.replace(/\s*\(\d+\)$/, "");
  const groupNames = [
    "cluster",
    "database",
    "schemas",
    "tables",
    "views",
    "materialized-views",
    "functions",
    "procedures",
    "aggregates",
    "sequences",
    "types",
    "enums",
    "composite-types",
    "ranges",
    "domains",
    "collations",
    "foreign-tables",
    "columns",
    "indexes",
    "triggers",
    "rules",
    "policies",
    "partitions",
    "roles",
    "extensions",
    "event-triggers",
    "publications",
    "subscriptions",
    "foreign-data-wrappers",
    "servers",
    "user-mappings",
  ];

  if (groupNames.includes(baseName)) {
    return chalk.dim(name);
  }

  return name;
}

/**
 * Colorize tree connectors (├─ └─ │).
 */
function colorizeConnector(connector: string): string {
  return chalk.dim(connector);
}

/**
 * Render a group (branch node) and its children.
 */
function renderGroup(
  group: TreeGroup,
  prefix: string,
  isLast: boolean,
  lines: string[],
): void {
  const hasItems = group.items && group.items.length > 0;
  const hasGroups = group.groups && group.groups.length > 0;

  // Render items first
  if (hasItems && group.items) {
    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const isLastItem = i === group.items.length - 1 && !hasGroups;
      const connector = isLastItem && isLast ? CONNECTOR_LAST : CONNECTOR_MID;
      const coloredConnector = colorizeConnector(connector);
      const coloredName = colorizeName(item.name);
      const coloredPrefix = colorizePrefix(prefix);
      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);
    }
  }

  // Render groups
  if (hasGroups && group.groups) {
    for (let i = 0; i < group.groups.length; i++) {
      const childGroup = group.groups[i];
      const isLastGroup = i === group.groups.length - 1;
      const connector = isLastGroup && isLast ? CONNECTOR_LAST : CONNECTOR_MID;
      const childPrefix =
        isLastGroup && isLast ? INDENT_LAST : INDENT_WITH_CHILD;
      const coloredConnector = colorizeConnector(connector);
      const coloredPrefix = colorizePrefix(prefix);
      const coloredName = colorizeName(childGroup.name);

      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);

      // Recursively render child group if it has children
      if (childGroup.items || childGroup.groups) {
        renderGroup(
          childGroup,
          prefix + childPrefix,
          isLastGroup && isLast,
          lines,
        );
      }
    }
  }
}

/**
 * Render children of a (already printed) group without printing the group's own line.
 */
function renderChildren(
  items: TreeItem[] | undefined,
  groups: TreeGroup[] | undefined,
  prefix: string,
  lines: string[],
): void {
  const hasItems = items && items.length > 0;
  const hasGroups = groups && groups.length > 0;

  if (hasItems && items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isLastItem = i === items.length - 1 && !hasGroups;
      const connector = isLastItem ? CONNECTOR_LAST : CONNECTOR_MID;
      const coloredConnector = colorizeConnector(connector);
      const coloredName = colorizeName(item.name);
      const coloredPrefix = colorizePrefix(prefix);
      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);
    }
  }

  if (hasGroups && groups) {
    for (let i = 0; i < groups.length; i++) {
      const childGroup = groups[i];
      const isLastGroup = i === groups.length - 1;
      const connector = isLastGroup ? CONNECTOR_LAST : CONNECTOR_MID;
      const childPrefix = isLastGroup ? INDENT_LAST : INDENT_WITH_CHILD;
      const coloredConnector = colorizeConnector(connector);
      const coloredPrefix = colorizePrefix(prefix);
      const coloredName = colorizeName(childGroup.name);

      lines.push(`${coloredPrefix}${coloredConnector} ${coloredName}`);

      if (childGroup.items || childGroup.groups) {
        renderGroup(childGroup, prefix + childPrefix, isLastGroup, lines);
      }
    }
  }
}

/**
 * Colorize tree prefix (vertical lines).
 */
function colorizePrefix(prefix: string): string {
  return prefix.replace(new RegExp(VERTICAL, "g"), chalk.dim(VERTICAL));
}
