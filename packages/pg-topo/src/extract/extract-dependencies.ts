import type { StatementClass } from "../classify/classify-statement.ts";
import {
  createObjectRef,
  createObjectRefFromAst,
  DEFAULT_SCHEMA,
  dedupeObjectRefs,
  isBuiltInObjectRef,
  markExactSignatureRef,
  markOmitIfNoLocalProducerRef,
  SHELL_TYPE_SIGNATURE,
  splitQualifiedName,
} from "../model/object-ref.ts";
import type { AnnotationHints, ObjectRef } from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";
import {
  addExpressionDependencies,
  addRoutineBodyDependencies,
} from "./expression-dependencies.ts";
import {
  addForeignConstraintDependencies,
  addSchemaDependencyIfNeeded,
  constraintKeyColumns,
  extractNameParts,
  extractStringValue,
  keyRefForTableColumns,
  objectFromNameParts,
  objectKindFromObjType,
  parseNamedObjectRef,
  relationFromRangeVarNode,
  roleNameFromRoleSpec,
  typeFromTypeNameNode,
} from "./shared-refs.ts";

type ExtractDependenciesResult = {
  provides: ObjectRef[];
  requires: ObjectRef[];
};

const extractCreateTableDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const relation = asRecord(statementNode.relation);
  const tableRef = relationFromRangeVarNode(relation, "table");
  if (tableRef) {
    provides.push(tableRef);
    addSchemaDependencyIfNeeded(relation?.schemaname, requires);
  }

  const inheritanceRelations = Array.isArray(statementNode.inhRelations)
    ? statementNode.inhRelations
    : [];
  for (const inheritanceRelationNode of inheritanceRelations) {
    const parentRelationRef = relationFromRangeVarNode(
      asRecord(inheritanceRelationNode)?.RangeVar ?? inheritanceRelationNode,
      "table",
    );
    if (parentRelationRef) {
      requires.push(parentRelationRef);
    }
  }

  const tableElements = Array.isArray(statementNode.tableElts)
    ? statementNode.tableElts
    : [];
  for (const tableElement of tableElements) {
    const elementNode = asRecord(tableElement);
    const columnDefinition = asRecord(elementNode?.ColumnDef);
    const tableConstraint = asRecord(elementNode?.Constraint);

    if (columnDefinition) {
      const typeRef = typeFromTypeNameNode(columnDefinition.typeName);
      if (typeRef) {
        requires.push(typeRef);
      }

      const constraints = Array.isArray(columnDefinition.constraints)
        ? columnDefinition.constraints
        : [];
      for (const constraintItem of constraints) {
        const constraint = asRecord(asRecord(constraintItem)?.Constraint);
        if (!constraint) {
          continue;
        }
        if (constraint.contype === "CONSTR_FOREIGN") {
          addForeignConstraintDependencies(constraint, requires);
        }
        if (
          tableRef &&
          (constraint.contype === "CONSTR_PRIMARY" ||
            constraint.contype === "CONSTR_UNIQUE")
        ) {
          const columnName =
            typeof columnDefinition.colname === "string"
              ? columnDefinition.colname
              : undefined;
          const providedKey = keyRefForTableColumns(
            tableRef,
            constraintKeyColumns(constraint, columnName),
          );
          if (providedKey) {
            provides.push(providedKey);
          }
        }
        if (constraint.raw_expr) {
          addExpressionDependencies(constraint.raw_expr, requires);
        }
      }
    }

    if (tableConstraint) {
      if (tableConstraint.contype === "CONSTR_FOREIGN") {
        addForeignConstraintDependencies(tableConstraint, requires);
      }
      if (
        tableRef &&
        (tableConstraint.contype === "CONSTR_PRIMARY" ||
          tableConstraint.contype === "CONSTR_UNIQUE")
      ) {
        const providedKey = keyRefForTableColumns(
          tableRef,
          constraintKeyColumns(tableConstraint),
        );
        if (providedKey) {
          provides.push(providedKey);
        }
      }
      if (tableConstraint.raw_expr) {
        addExpressionDependencies(tableConstraint.raw_expr, requires);
      }
    }
  }

  return { provides, requires };
};

const extractCreateTableAsDependencies = (
  statementNode: Record<string, unknown>,
  kind: "table" | "materialized_view",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const intoClause = asRecord(statementNode.into);
  const relation = asRecord(intoClause?.rel);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    provides.push(
      createObjectRefFromAst(kind, relationRef.name, relationRef.schema),
    );
    if (relationRef.schema) {
      requires.push(createObjectRefFromAst("schema", relationRef.schema));
    }
  }

  addExpressionDependencies(statementNode.query, requires);
  return { provides, requires };
};

const addConstraintExpressionDependencies = (
  constraint: Record<string, unknown> | undefined,
  requires: ObjectRef[],
): void => {
  if (!constraint) {
    return;
  }
  for (const expressionNode of [
    constraint.raw_expr,
    constraint.exclusions,
    constraint.where_clause,
  ]) {
    if (expressionNode) {
      addExpressionDependencies(expressionNode, requires);
    }
  }
};

const extractAlterTableDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const objectKind = objectKindFromObjType(statementNode.objtype) ?? "table";
  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, objectKind);
  const relationTableRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    requires.push(relationRef);
  }

  const commands = Array.isArray(statementNode.cmds) ? statementNode.cmds : [];
  for (const commandNode of commands) {
    const command = asRecord(asRecord(commandNode)?.AlterTableCmd);
    const constraint = asRecord(asRecord(command?.def)?.Constraint);
    const columnDefinition = asRecord(asRecord(command?.def)?.ColumnDef);
    if (constraint?.contype === "CONSTR_FOREIGN") {
      addForeignConstraintDependencies(constraint, requires);
    }
    if (
      relationTableRef &&
      (constraint?.contype === "CONSTR_PRIMARY" ||
        constraint?.contype === "CONSTR_UNIQUE")
    ) {
      const providedKey = keyRefForTableColumns(
        relationTableRef,
        constraintKeyColumns(constraint),
      );
      if (providedKey) {
        provides.push(providedKey);
      }
    }
    addConstraintExpressionDependencies(constraint, requires);

    if (columnDefinition?.raw_default) {
      addExpressionDependencies(columnDefinition.raw_default, requires);
    }
    const typeRef = typeFromTypeNameNode(columnDefinition?.typeName);
    if (typeRef) {
      requires.push(typeRef);
    }
    const columnConstraints = Array.isArray(columnDefinition?.constraints)
      ? columnDefinition.constraints
      : [];
    for (const constraintItem of columnConstraints) {
      const columnConstraint = asRecord(asRecord(constraintItem)?.Constraint);
      if (columnConstraint?.contype === "CONSTR_FOREIGN") {
        addForeignConstraintDependencies(columnConstraint, requires);
      }
      if (
        relationTableRef &&
        (columnConstraint?.contype === "CONSTR_PRIMARY" ||
          columnConstraint?.contype === "CONSTR_UNIQUE")
      ) {
        const columnName =
          typeof columnDefinition?.colname === "string"
            ? columnDefinition.colname
            : undefined;
        const providedKey = keyRefForTableColumns(
          relationTableRef,
          constraintKeyColumns(columnConstraint, columnName),
        );
        if (providedKey) {
          provides.push(providedKey);
        }
      }
      addConstraintExpressionDependencies(columnConstraint, requires);
    }

    if (command?.subtype === "AT_ColumnDefault" && command.def) {
      addExpressionDependencies(command.def, requires);
    }

    if (command?.subtype === "AT_ChangeOwner") {
      const roleName = roleNameFromRoleSpec(command.newowner);
      if (roleName) {
        requires.push(createObjectRefFromAst("role", roleName));
      }
    }

    if (command?.subtype === "AT_AttachPartition") {
      const partitionCommand = asRecord(asRecord(command.def)?.PartitionCmd);
      const partitionName = partitionCommand?.name;
      const partitionRef = relationFromRangeVarNode(partitionName, objectKind);
      if (partitionRef) {
        requires.push(partitionRef);
      }
    }
  }

  return { provides, requires };
};

const extractCreateFunctionDependencies = (
  statementNode: Record<string, unknown>,
  kind: "function" | "procedure",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const functionNameParts = extractNameParts(statementNode.funcname);
  const parameters = Array.isArray(statementNode.parameters)
    ? statementNode.parameters
    : [];
  const signatureParts: string[] = [];

  for (const parameterNode of parameters) {
    const functionParameter = asRecord(
      asRecord(parameterNode)?.FunctionParameter,
    );
    const argType = typeFromTypeNameNode(functionParameter?.argType);
    if (argType) {
      requires.push(argType);
      signatureParts.push(
        argType.schema ? `${argType.schema}.${argType.name}` : argType.name,
      );
    } else {
      signatureParts.push("unknown");
    }
  }

  const functionRef = objectFromNameParts(kind, functionNameParts);
  if (functionRef) {
    provides.push(
      createObjectRefFromAst(
        kind,
        functionRef.name,
        functionRef.schema,
        `(${signatureParts.join(",")})`,
      ),
    );
    if (functionRef.schema) {
      requires.push(createObjectRefFromAst("schema", functionRef.schema));
    }
  }

  const returnType = typeFromTypeNameNode(statementNode.returnType);
  if (returnType) {
    requires.push(returnType);
  }

  addRoutineBodyDependencies(statementNode, requires);

  return { provides, requires };
};

const extractViewDependencies = (
  statementNode: Record<string, unknown>,
  kind: "view" | "materialized_view",
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const viewRelation = asRecord(statementNode.view);
  const tableRef = relationFromRangeVarNode(viewRelation, "table");
  if (tableRef) {
    provides.push(createObjectRefFromAst(kind, tableRef.name, tableRef.schema));
    // A plain view implicitly owns an "_RETURN" ON SELECT rewrite rule. Expose it
    // so `COMMENT ON RULE "_RETURN" ON <view>` resolves to the view instead of
    // reporting an unresolved dependency. Materialized views have no such rule.
    if (kind === "view") {
      provides.push(
        createObjectRefFromAst(
          "rule",
          `${tableRef.name}._RETURN`,
          tableRef.schema ?? DEFAULT_SCHEMA,
        ),
      );
    }
    if (tableRef.schema) {
      requires.push(createObjectRefFromAst("schema", tableRef.schema));
    }
  }

  addExpressionDependencies(statementNode.query, requires);
  return { provides, requires };
};

const extractTriggerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    const triggerName =
      typeof statementNode.trigname === "string"
        ? statementNode.trigname
        : "trigger";
    provides.push(
      createObjectRefFromAst(
        "trigger",
        `${relationRef.name}.${triggerName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  const functionRef = objectFromNameParts(
    "function",
    extractNameParts(statementNode.funcname),
  );
  if (functionRef) {
    requires.push(functionRef);
  }

  return { provides, requires };
};

const extractRuleDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relation = asRecord(statementNode.relation);
  const relationRef = relationFromRangeVarNode(relation, "table");
  if (relationRef) {
    const ruleName =
      typeof statementNode.rulename === "string"
        ? statementNode.rulename
        : "rule";
    provides.push(
      createObjectRefFromAst(
        "rule",
        `${relationRef.name}.${ruleName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.whereClause, requires);

  const actions = Array.isArray(statementNode.actions)
    ? statementNode.actions
    : [];
  for (const action of actions) {
    addExpressionDependencies(action, requires);
  }

  return { provides, requires };
};

const extractPolicyDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relationRef = relationFromRangeVarNode(statementNode.table, "table");
  const policyName =
    typeof statementNode.policy_name === "string"
      ? statementNode.policy_name
      : "policy";
  if (relationRef) {
    provides.push(
      createObjectRefFromAst(
        "policy",
        `${relationRef.name}.${policyName}`,
        relationRef.schema ?? DEFAULT_SCHEMA,
      ),
    );
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.qual, requires);
  addExpressionDependencies(statementNode.with_check, requires);
  return { provides, requires };
};

const extractGrantDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const objectKind = objectKindFromObjType(statementNode.objtype);
  const objects = Array.isArray(statementNode.objects)
    ? statementNode.objects
    : [];
  for (const objectNode of objects) {
    if (!objectKind) {
      continue;
    }
    const objectRef = parseNamedObjectRef(objectNode, objectKind);
    if (objectRef) {
      requires.push(objectRef);
    }
  }

  const grantees = Array.isArray(statementNode.grantees)
    ? statementNode.grantees
    : [];
  for (const granteeNode of grantees) {
    const roleSpec = asRecord(asRecord(granteeNode)?.RoleSpec);
    const roleName = roleNameFromRoleSpec(roleSpec);
    if (roleName) {
      requires.push(createObjectRefFromAst("role", roleName));
    }
  }

  return { provides, requires };
};

const extractCommentDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const objectKind = objectKindFromObjType(statementNode.objtype);
  if (!objectKind) {
    return { provides: [], requires: [] };
  }
  const objectRef = parseNamedObjectRef(statementNode.object, objectKind);
  return {
    provides: [],
    requires: objectRef ? [objectRef] : [],
  };
};

const extractAlterOwnerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];
  const objectKind = objectKindFromObjType(statementNode.objectType);
  if (objectKind) {
    const objectRef = parseNamedObjectRef(statementNode.object, objectKind);
    if (objectRef) {
      requires.push(objectRef);
    }
  }

  const roleName = roleNameFromRoleSpec(statementNode.newowner);
  if (roleName) {
    requires.push(createObjectRefFromAst("role", roleName));
  }

  return { provides: [], requires };
};

const extractCreatePublicationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.pubname === "string") {
    provides.push(createObjectRefFromAst("publication", statementNode.pubname));
  }

  addPublicationObjectDependencies(statementNode.pubobjects, requires);

  return { provides, requires };
};

const addPublicationObjectDependencies = (
  objects: unknown,
  requires: ObjectRef[],
): void => {
  const publicationObjects = Array.isArray(objects) ? objects : [];
  for (const objectNode of publicationObjects) {
    const publicationObjSpec = asRecord(
      asRecord(objectNode)?.PublicationObjSpec,
    );
    if (!publicationObjSpec) {
      continue;
    }
    const publicationObjType = publicationObjSpec.pubobjtype;
    const publicationTable = asRecord(publicationObjSpec.pubtable);
    if (publicationObjType === "PUBLICATIONOBJ_TABLE") {
      const relation = asRecord(publicationTable?.relation);
      const tableRef = relationFromRangeVarNode(relation, "table");
      if (tableRef) {
        requires.push(tableRef);
      }
      addExpressionDependencies(publicationTable?.whereClause, requires);
    }
    if (
      publicationObjType === "PUBLICATIONOBJ_TABLES_IN_SCHEMA" &&
      typeof publicationObjSpec.name === "string"
    ) {
      requires.push(createObjectRefFromAst("schema", publicationObjSpec.name));
    }
  }
};

const extractAlterPublicationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];

  if (typeof statementNode.pubname === "string") {
    requires.push(createObjectRefFromAst("publication", statementNode.pubname));
  }

  if (
    statementNode.action === "AP_AddObjects" ||
    statementNode.action === "AP_DropObjects" ||
    statementNode.action === "AP_SetObjects"
  ) {
    addPublicationObjectDependencies(statementNode.pubobjects, requires);
  }

  return { provides: [], requires };
};

const extractCreateLanguageDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  if (typeof statementNode.plname === "string") {
    provides.push(createObjectRefFromAst("language", statementNode.plname));
  }
  return { provides, requires };
};

const extractCreateForeignDataWrapperDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  if (typeof statementNode.fdwname === "string") {
    provides.push(
      createObjectRefFromAst("foreign_data_wrapper", statementNode.fdwname),
    );
  }
  return { provides, requires };
};

const extractCreateForeignServerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.servername === "string") {
    provides.push(
      createObjectRefFromAst("foreign_server", statementNode.servername),
    );
  }
  if (typeof statementNode.fdwname === "string") {
    requires.push(
      createObjectRefFromAst("foreign_data_wrapper", statementNode.fdwname),
    );
  }

  return { provides, requires };
};

const extractCreateSubscriptionDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.subname === "string") {
    provides.push(
      createObjectRefFromAst("subscription", statementNode.subname),
    );
  }

  const publications = Array.isArray(statementNode.publication)
    ? statementNode.publication
    : [];
  for (const publicationNode of publications) {
    const publicationName = extractStringValue(publicationNode);
    if (publicationName) {
      requires.push(createObjectRefFromAst("publication", publicationName));
    }
  }

  return { provides, requires };
};

const extractAlterSubscriptionDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const requires: ObjectRef[] = [];

  if (typeof statementNode.subname === "string") {
    requires.push(
      createObjectRefFromAst("subscription", statementNode.subname),
    );
  }

  if (
    statementNode.kind === "ALTER_SUBSCRIPTION_SET_PUBLICATION" ||
    statementNode.kind === "ALTER_SUBSCRIPTION_ADD_PUBLICATION"
  ) {
    const publications = Array.isArray(statementNode.publication)
      ? statementNode.publication
      : [];
    for (const publicationNode of publications) {
      const publicationName = extractStringValue(publicationNode);
      if (publicationName) {
        requires.push(createObjectRefFromAst("publication", publicationName));
      }
    }
  }

  return { provides: [], requires };
};

const extractCreateEventTriggerDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  if (typeof statementNode.trigname === "string") {
    provides.push(
      createObjectRefFromAst("event_trigger", statementNode.trigname),
    );
  }

  const functionRef = objectFromNameParts(
    "function",
    extractNameParts(statementNode.funcname),
  );
  if (functionRef) {
    requires.push(functionRef);
  }

  return { provides, requires };
};

const extractCreateCollationDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const collationRef = objectFromNameParts(
    "collation",
    extractNameParts(statementNode.defnames),
  );
  if (collationRef) {
    provides.push(collationRef);
    if (collationRef.schema) {
      requires.push(createObjectRefFromAst("schema", collationRef.schema));
    }
  }

  return { provides, requires };
};

const rangeFunctionOptionNames = new Set(["canonical", "subtype_diff"]);

// PostgreSQL documents float8mi as the built-in subtype_diff helper for
// custom float ranges. Other unqualified support functions remain dependencies
// so custom routines still order before the range type that uses them.
const builtInRangeSupportFunctionNames = new Set(["float8mi"]);

const isFloat8TypeRef = (typeRef: ObjectRef | null): boolean => {
  if (!typeRef || typeRef.kind !== "type") {
    return false;
  }
  return typeRef.name.toLowerCase() === "float8" && isBuiltInObjectRef(typeRef);
};

const isBuiltInRangeSupportFunctionName = (
  nameParts: string[],
  subtypeRef: ObjectRef | null,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInRangeSupportFunctionNames.has(name)) {
    return false;
  }

  if (nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog") {
    return true;
  }

  // Unqualified float8mi is pg_catalog's helper only for float8 subtypes. For
  // other subtypes it can resolve to a user-defined overload and must stay as a
  // dependency.
  return nameParts.length === 1 && isFloat8TypeRef(subtypeRef);
};

// PostgreSQL standard/predefined collations live in pg_catalog. User collations
// with the same name still need a dependency when explicitly schema-qualified.
const builtInRangeCollationNames = new Set([
  "c",
  "default",
  "pg_c_utf8",
  "pg_unicode_fast",
  "posix",
  "ucs_basic",
  "unicode",
]);

const isBuiltInRangeCollationName = (nameParts: string[]): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInRangeCollationNames.has(name)) {
    return false;
  }

  if (nameParts.length === 1) {
    return true;
  }

  return nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog";
};

// Common pg_catalog btree operator classes that can be used as range
// SUBTYPE_OPCLASS values without an input CREATE OPERATOR CLASS statement.
const builtInRangeOperatorClassNames = new Set([
  "array_ops",
  "bit_ops",
  "bool_ops",
  "bpchar_ops",
  "bytea_ops",
  "char_ops",
  "cidr_ops",
  "date_ops",
  "enum_ops",
  "float4_ops",
  "float8_ops",
  "inet_ops",
  "int2_ops",
  "int4_ops",
  "int8_ops",
  "interval_ops",
  "jsonb_ops",
  "macaddr8_ops",
  "macaddr_ops",
  "money_ops",
  "name_ops",
  "numeric_ops",
  "oid_ops",
  "record_ops",
  "text_ops",
  "time_ops",
  "timestamp_ops",
  "timestamptz_ops",
  "timetz_ops",
  "uuid_ops",
  "varbit_ops",
  "varchar_ops",
]);

const builtInRangeOperatorClassSubtypes = new Map<string, string[]>([
  ["bit_ops", ["bit"]],
  ["bool_ops", ["bool"]],
  ["bpchar_ops", ["bpchar"]],
  ["bytea_ops", ["bytea"]],
  ["char_ops", ["char"]],
  ["cidr_ops", ["cidr"]],
  ["date_ops", ["date"]],
  ["float4_ops", ["float4"]],
  ["float8_ops", ["float8"]],
  ["inet_ops", ["inet"]],
  ["int2_ops", ["int2"]],
  ["int4_ops", ["int4"]],
  ["int8_ops", ["int8"]],
  ["interval_ops", ["interval"]],
  ["jsonb_ops", ["jsonb"]],
  ["macaddr8_ops", ["macaddr8"]],
  ["macaddr_ops", ["macaddr"]],
  ["money_ops", ["money"]],
  ["name_ops", ["name"]],
  ["numeric_ops", ["numeric"]],
  ["oid_ops", ["oid"]],
  ["text_ops", ["text"]],
  ["time_ops", ["time"]],
  ["timestamp_ops", ["timestamp"]],
  ["timestamptz_ops", ["timestamptz"]],
  ["timetz_ops", ["timetz"]],
  ["uuid_ops", ["uuid"]],
  ["varbit_ops", ["varbit"]],
  ["varchar_ops", ["varchar"]],
]);

const typeRefMatchesBuiltInNames = (
  typeRef: ObjectRef | null,
  names: string[],
): boolean => {
  if (!typeRef || typeRef.kind !== "type") {
    return false;
  }
  return (
    isBuiltInObjectRef(typeRef) && names.includes(typeRef.name.toLowerCase())
  );
};

const isBuiltInRangeOperatorClassName = (
  nameParts: string[],
  subtypeRef: ObjectRef | null,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInRangeOperatorClassNames.has(name)) {
    return false;
  }

  if (nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog") {
    return true;
  }

  if (nameParts.length !== 1) {
    return false;
  }

  const expectedSubtypes = builtInRangeOperatorClassSubtypes.get(name);
  if (!expectedSubtypes) {
    return true;
  }

  // Some user-defined opclasses intentionally reuse built-in names. Only skip
  // concrete built-in names when the range subtype matches the pg_catalog
  // opclass they normally belong to.
  return typeRefMatchesBuiltInNames(subtypeRef, expectedSubtypes);
};

const builtInBtreeOperatorFamilyNames = new Set([
  ...builtInRangeOperatorClassNames,
  "datetime_ops",
  "float_ops",
  "integer_ops",
  "network_ops",
]);

const isBuiltInBtreeOperatorFamilyName = (nameParts: string[]): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInBtreeOperatorFamilyNames.has(name)) {
    return false;
  }

  if (nameParts.length === 1) {
    return true;
  }

  return nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog";
};

// Opclass items commonly reference pg_catalog support objects without schema
// qualification. Keep PostgreSQL's built-in btree support routines out of
// dependency resolution while still requiring user-defined unqualified support
// items such as <# or app.cmp(...).
const builtInOperatorClassSupportFunctionSignatures = new Map<
  string,
  string[][]
>([
  ["bitcmp", [["bit", "bit"]]],
  ["bpchar_sortsupport", [["internal"]]],
  ["bpcharcmp", [["bpchar", "bpchar"]]],
  ["btarraycmp", [["anyarray", "anyarray"]]],
  ["btboolcmp", [["bool", "bool"]]],
  ["btbpchar_pattern_cmp", [["bpchar", "bpchar"]]],
  ["btbpchar_pattern_sortsupport", [["internal"]]],
  ["btcharcmp", [["char", "char"]]],
  ["btequalimage", [["oid"]]],
  ["btfloat4cmp", [["float4", "float4"]]],
  ["btfloat4sortsupport", [["internal"]]],
  ["btfloat8cmp", [["float8", "float8"]]],
  ["btfloat8sortsupport", [["internal"]]],
  ["btint2cmp", [["int2", "int2"]]],
  ["btint2sortsupport", [["internal"]]],
  ["btint4cmp", [["int4", "int4"]]],
  ["btint4sortsupport", [["internal"]]],
  ["btint8cmp", [["int8", "int8"]]],
  ["btint8sortsupport", [["internal"]]],
  ["btnamecmp", [["name", "name"]]],
  ["btnamesortsupport", [["internal"]]],
  ["btoidcmp", [["oid", "oid"]]],
  ["btoidsortsupport", [["internal"]]],
  ["btoidvectorcmp", [["oidvector", "oidvector"]]],
  ["btrecordcmp", [["record", "record"]]],
  ["btrecordimagecmp", [["record", "record"]]],
  ["bttext_pattern_cmp", [["text", "text"]]],
  ["bttext_pattern_sortsupport", [["internal"]]],
  ["bttextcmp", [["text", "text"]]],
  ["bttextsortsupport", [["internal"]]],
  ["bttidcmp", [["tid", "tid"]]],
  ["btvarstrequalimage", [["oid"]]],
  ["bytea_sortsupport", [["internal"]]],
  ["byteacmp", [["bytea", "bytea"]]],
  ["cash_cmp", [["money", "money"]]],
  ["date_cmp", [["date", "date"]]],
  ["date_sortsupport", [["internal"]]],
  ["enum_cmp", [["anyenum", "anyenum"]]],
  [
    "in_range",
    [
      ["float8", "float8", "float8", "bool", "bool"],
      ["int2", "int2", "int2", "bool", "bool"],
      ["int4", "int4", "int4", "bool", "bool"],
      ["int8", "int8", "int8", "bool", "bool"],
      ["interval", "interval", "interval", "bool", "bool"],
      ["numeric", "numeric", "numeric", "bool", "bool"],
    ],
  ],
  ["interval_cmp", [["interval", "interval"]]],
  ["jsonb_cmp", [["jsonb", "jsonb"]]],
  ["macaddr8_cmp", [["macaddr8", "macaddr8"]]],
  ["macaddr_cmp", [["macaddr", "macaddr"]]],
  ["macaddr_sortsupport", [["internal"]]],
  ["multirange_cmp", [["anymultirange", "anymultirange"]]],
  ["network_cmp", [["inet", "inet"]]],
  ["network_sortsupport", [["internal"]]],
  ["numeric_cmp", [["numeric", "numeric"]]],
  ["numeric_sortsupport", [["internal"]]],
  ["pg_lsn_cmp", [["pg_lsn", "pg_lsn"]]],
  ["range_cmp", [["anyrange", "anyrange"]]],
  ["time_cmp", [["time", "time"]]],
  ["timestamp_cmp", [["timestamp", "timestamp"]]],
  ["timestamp_sortsupport", [["internal"]]],
  ["timestamptz_cmp", [["timestamptz", "timestamptz"]]],
  ["timetz_cmp", [["timetz", "timetz"]]],
  ["tsquery_cmp", [["tsquery", "tsquery"]]],
  ["tsvector_cmp", [["tsvector", "tsvector"]]],
  ["uuid_cmp", [["uuid", "uuid"]]],
  ["uuid_sortsupport", [["internal"]]],
  ["varbitcmp", [["varbit", "varbit"]]],
  ["xid8cmp", [["xid8", "xid8"]]],
]);

const isBuiltInOperatorClassSupportFunctionName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }
  const builtInSignatures =
    builtInOperatorClassSupportFunctionSignatures.get(name);
  if (!builtInSignatures) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  return builtInSignatures.some(
    (signature) =>
      args.length === signature.length &&
      signature.every((typeName, index) =>
        typeRefMatchesBuiltInNames(args[index] ?? null, [typeName]),
      ),
  );
};

const builtInOperatorClassSupportOperatorNames = new Set([
  "<",
  "<=",
  "=",
  ">=",
  ">",
]);

const isBuiltInOperatorClassSupportOperatorName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
  operatorClassDataTypeRef: ObjectRef | null,
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (
    (nameParts.length !== 1 &&
      !(
        nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog"
      )) ||
    !name ||
    !builtInOperatorClassSupportOperatorNames.has(name)
  ) {
    return false;
  }

  if (args.length === 0) {
    return Boolean(
      operatorClassDataTypeRef && isBuiltInObjectRef(operatorClassDataTypeRef),
    );
  }

  return args.every((argRef) => argRef !== null && isBuiltInObjectRef(argRef));
};

const defaultMultirangeTypeName = (rangeTypeName: string): string =>
  rangeTypeName.includes("range")
    ? rangeTypeName.replace("range", "multirange")
    : `${rangeTypeName}_multirange`;

const baseTypeFunctionOptionNames = new Set([
  "input",
  "output",
  "receive",
  "send",
  "typmod_in",
  "typmod_out",
  "analyze",
  "subscript",
]);

const baseTypeTypeOptionNames = new Set(["like", "element"]);

const typeSignaturePart = (typeRef: ObjectRef): string =>
  typeRef.schema ? `${typeRef.schema}.${typeRef.name}` : typeRef.name;

const objectWithArgsTypeRefs = (
  objectWithArgs: unknown,
): (ObjectRef | null)[] => {
  const objectWithArgsRecord = asRecord(objectWithArgs);
  const args = Array.isArray(objectWithArgsRecord?.objargs)
    ? objectWithArgsRecord.objargs
    : [];

  return args.map((argNode) =>
    typeFromTypeNameNode(asRecord(argNode)?.TypeName),
  );
};

const typeRefsSignature = (args: (ObjectRef | null)[]): string =>
  `(${args
    .map((argRef) => (argRef ? typeSignaturePart(argRef) : "unknown"))
    .join(",")})`;

const objectWithArgsRef = (
  kind: ObjectRef["kind"],
  objectWithArgs: unknown,
  defaultArgs: (ObjectRef | null)[] = [],
): ObjectRef | null => {
  const objectWithArgsRecord = asRecord(objectWithArgs);
  if (!objectWithArgsRecord) {
    return null;
  }

  const baseRef = objectFromNameParts(
    kind,
    extractNameParts(objectWithArgsRecord.objname),
  );
  if (!baseRef) {
    return null;
  }

  const explicitArgs = objectWithArgsTypeRefs(objectWithArgsRecord);
  const args = explicitArgs.length > 0 ? explicitArgs : defaultArgs;
  if (args.length === 0) {
    return baseRef;
  }

  return createObjectRefFromAst(
    kind,
    baseRef.name,
    baseRef.schema,
    typeRefsSignature(args),
  );
};

const objectRefFromNamePartsWithArgs = (
  kind: ObjectRef["kind"],
  nameParts: string[],
  args: (ObjectRef | null)[],
): ObjectRef | null => {
  const baseRef = objectFromNameParts(kind, nameParts);
  if (!baseRef) {
    return null;
  }
  if (args.length === 0) {
    return baseRef;
  }

  return createObjectRefFromAst(
    kind,
    baseRef.name,
    baseRef.schema,
    typeRefsSignature(args),
  );
};

const rangeFunctionArgs = (
  optionName: string,
  rangeRef: ObjectRef | null,
  subtypeRef: ObjectRef | null,
): (ObjectRef | null)[] => {
  if (optionName === "canonical") {
    return rangeRef ? [rangeRef] : [];
  }

  if (optionName === "subtype_diff") {
    return subtypeRef ? [subtypeRef, subtypeRef] : [];
  }

  return [];
};

const rangeSubtypeRef = (params: unknown[]): ObjectRef | null => {
  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    if (!defElem) {
      continue;
    }
    const optionName =
      typeof defElem.defname === "string" ? defElem.defname.toLowerCase() : "";
    if (optionName !== "subtype") {
      continue;
    }
    return typeFromTypeNameNode(asRecord(asRecord(defElem.arg)?.TypeName));
  }

  return null;
};

const objectRefsSameObject = (
  left: ObjectRef | null,
  right: ObjectRef | null,
): boolean => {
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  return (
    (left.schema ?? DEFAULT_SCHEMA) === (right.schema ?? DEFAULT_SCHEMA) &&
    left.name === right.name
  );
};

export const omittedRangeSubtypeOperatorClassSubtypeRef = (
  statementNode: unknown,
): ObjectRef | null => {
  const statementRecord = asRecord(statementNode);
  if (!statementRecord) {
    return null;
  }

  const rangeStatement =
    asRecord(statementRecord.CreateRangeStmt) ?? statementRecord;
  const params = Array.isArray(rangeStatement.params)
    ? rangeStatement.params
    : [];
  const subtypeRef = rangeSubtypeRef(params);

  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    const optionName =
      typeof defElem?.defname === "string" ? defElem.defname.toLowerCase() : "";
    if (optionName === "subtype_opclass") {
      return null;
    }
  }

  if (!subtypeRef || isBuiltInObjectRef(subtypeRef)) {
    return null;
  }

  return subtypeRef;
};

export const defaultBtreeOperatorClassProviderRefForSubtype = (
  statementNode: unknown,
  subtypeRef: ObjectRef,
): ObjectRef | null => {
  const statementRecord = asRecord(statementNode);
  const opClassStatement =
    asRecord(statementRecord?.CreateOpClassStmt) ?? statementRecord;
  if (!opClassStatement) {
    return null;
  }

  if (opClassStatement.isDefault !== true) {
    return null;
  }

  if (
    typeof opClassStatement.amname !== "string" ||
    opClassStatement.amname.toLowerCase() !== "btree"
  ) {
    return null;
  }

  const dataTypeRef = typeFromTypeNameNode(opClassStatement.datatype);
  if (!objectRefsSameObject(dataTypeRef, subtypeRef)) {
    return null;
  }

  const operatorClassRef = objectFromNameParts(
    "operator_class",
    extractNameParts(opClassStatement.opclassname),
  );
  return operatorClassRef
    ? createObjectRefFromAst(
        "operator_class",
        operatorClassRef.name,
        operatorClassRef.schema,
        "btree",
      )
    : null;
};

const extractCreateRangeDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const rangeRef = objectFromNameParts(
    "type",
    extractNameParts(statementNode.typeName),
  );
  if (rangeRef) {
    provides.push(
      createObjectRefFromAst("type", rangeRef.name, rangeRef.schema),
    );
    if (rangeRef.schema) {
      requires.push(createObjectRefFromAst("schema", rangeRef.schema));
    }
  }

  const params = Array.isArray(statementNode.params)
    ? statementNode.params
    : [];
  const subtypeRef = rangeSubtypeRef(params);
  let hasExplicitMultirangeTypeName = false;

  for (const paramNode of params) {
    const defElem = asRecord(asRecord(paramNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }
    const optionName = defElem.defname.toLowerCase();
    const typeName = asRecord(asRecord(defElem.arg)?.TypeName);

    if (optionName === "subtype") {
      const typeRef = typeFromTypeNameNode(typeName);
      if (typeRef) {
        requires.push(typeRef);
      }
      continue;
    }

    if (optionName === "collation") {
      const collationNameParts = extractNameParts(typeName?.names);
      const collationRef = objectFromNameParts("collation", collationNameParts);
      if (collationRef && !isBuiltInRangeCollationName(collationNameParts)) {
        requires.push(collationRef);
      }
      continue;
    }

    if (optionName === "subtype_opclass") {
      const operatorClassNameParts = extractNameParts(typeName?.names);
      const operatorClassRef = objectFromNameParts(
        "operator_class",
        operatorClassNameParts,
      );
      if (
        operatorClassRef &&
        !isBuiltInRangeOperatorClassName(operatorClassNameParts, subtypeRef)
      ) {
        // PostgreSQL range subtypes resolve SUBTYPE_OPCLASS against the btree
        // access method, even when another method has an opclass with the same
        // schema/name.
        requires.push(
          createObjectRefFromAst(
            "operator_class",
            operatorClassRef.name,
            operatorClassRef.schema,
            "btree",
          ),
        );
      }
      continue;
    }

    if (optionName === "multirange_type_name") {
      hasExplicitMultirangeTypeName = true;
      const multirangeRef = objectFromNameParts(
        "type",
        extractNameParts(typeName?.names),
        rangeRef?.schema ?? DEFAULT_SCHEMA,
      );
      if (multirangeRef) {
        provides.push(
          createObjectRefFromAst(
            "type",
            multirangeRef.name,
            multirangeRef.schema,
          ),
        );
        if (multirangeRef.schema) {
          requires.push(createObjectRefFromAst("schema", multirangeRef.schema));
        }
      }
      continue;
    }

    if (rangeFunctionOptionNames.has(optionName)) {
      const functionNameParts = extractNameParts(typeName?.names);
      if (isBuiltInRangeSupportFunctionName(functionNameParts, subtypeRef)) {
        continue;
      }

      const functionRef = objectRefFromNamePartsWithArgs(
        "function",
        functionNameParts,
        rangeFunctionArgs(optionName, rangeRef, subtypeRef),
      );
      if (functionRef) {
        requires.push(functionRef);
      }
    }
  }

  if (rangeRef && !hasExplicitMultirangeTypeName) {
    // PostgreSQL creates a default multirange type alongside every range type.
    // The name is derived from the range type unless MULTIRANGE_TYPE_NAME is
    // present, in which case the explicit option above is the only provider.
    provides.push(
      createObjectRefFromAst(
        "type",
        defaultMultirangeTypeName(rangeRef.name),
        rangeRef.schema,
      ),
    );
  }

  return { provides, requires };
};

const operatorImplementationFunctionOptionNames = new Set([
  "function",
  "procedure",
]);
const operatorEstimatorFunctionOptionNames = new Set(["restrict", "join"]);
const builtInOperatorEstimatorFunctionNames = new Set([
  "areajoinsel",
  "areasel",
  "contjoinsel",
  "contsel",
  "eqjoinsel",
  "eqsel",
  "iclikejoinsel",
  "iclikesel",
  "icnlikejoinsel",
  "icnlikesel",
  "likejoinsel",
  "likesel",
  "matchingjoinsel",
  "matchingsel",
  "neqjoinsel",
  "neqsel",
  "nlikejoinsel",
  "nlikesel",
  "positionjoinsel",
  "positionsel",
  "scalarltjoinsel",
  "scalarltsel",
  "scalargtjoinsel",
  "scalargtsel",
]);

const builtInOperatorImplementationFunctionSignatures = new Map<
  string,
  string[][]
>([
  ["booleq", [["bool", "bool"]]],
  ["boolge", [["bool", "bool"]]],
  ["boolgt", [["bool", "bool"]]],
  ["boolle", [["bool", "bool"]]],
  ["boollt", [["bool", "bool"]]],
  ["boolne", [["bool", "bool"]]],
  ["int2eq", [["int2", "int2"]]],
  ["int2ge", [["int2", "int2"]]],
  ["int2gt", [["int2", "int2"]]],
  ["int2le", [["int2", "int2"]]],
  ["int2lt", [["int2", "int2"]]],
  ["int2ne", [["int2", "int2"]]],
  ["int4eq", [["int4", "int4"]]],
  ["int4ge", [["int4", "int4"]]],
  ["int4gt", [["int4", "int4"]]],
  ["int4le", [["int4", "int4"]]],
  ["int4lt", [["int4", "int4"]]],
  ["int4ne", [["int4", "int4"]]],
  ["int8eq", [["int8", "int8"]]],
  ["int8ge", [["int8", "int8"]]],
  ["int8gt", [["int8", "int8"]]],
  ["int8le", [["int8", "int8"]]],
  ["int8lt", [["int8", "int8"]]],
  ["int8ne", [["int8", "int8"]]],
  ["numeric_eq", [["numeric", "numeric"]]],
  ["numeric_ge", [["numeric", "numeric"]]],
  ["numeric_gt", [["numeric", "numeric"]]],
  ["numeric_le", [["numeric", "numeric"]]],
  ["numeric_lt", [["numeric", "numeric"]]],
  ["numeric_ne", [["numeric", "numeric"]]],
  ["texteq", [["text", "text"]]],
  ["text_ge", [["text", "text"]]],
  ["text_gt", [["text", "text"]]],
  ["text_le", [["text", "text"]]],
  ["text_lt", [["text", "text"]]],
  ["textne", [["text", "text"]]],
  ["uuid_eq", [["uuid", "uuid"]]],
  ["uuid_ge", [["uuid", "uuid"]]],
  ["uuid_gt", [["uuid", "uuid"]]],
  ["uuid_le", [["uuid", "uuid"]]],
  ["uuid_lt", [["uuid", "uuid"]]],
  ["uuid_ne", [["uuid", "uuid"]]],
]);

const operatorEstimatorFunctionArgs = (
  optionName: string,
): ObjectRef[] | null => {
  if (optionName === "restrict") {
    return [
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "oid"),
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "int4"),
    ];
  }

  if (optionName === "join") {
    return [
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "oid"),
      createObjectRefFromAst("type", "internal"),
      createObjectRefFromAst("type", "int2"),
      createObjectRefFromAst("type", "internal"),
    ];
  }

  return null;
};

const isBuiltInOperatorEstimatorFunctionName = (
  nameParts: string[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name || !builtInOperatorEstimatorFunctionNames.has(name)) {
    return false;
  }

  return (
    nameParts.length === 1 ||
    (nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  );
};

const isBuiltInOperatorImplementationFunctionName = (
  nameParts: string[],
  args: (ObjectRef | null)[],
): boolean => {
  const name = nameParts.at(-1)?.toLowerCase();
  if (!name) {
    return false;
  }
  const builtInSignatures =
    builtInOperatorImplementationFunctionSignatures.get(name);
  if (!builtInSignatures) {
    return false;
  }
  if (
    nameParts.length !== 1 &&
    !(nameParts.length === 2 && nameParts[0]?.toLowerCase() === "pg_catalog")
  ) {
    return false;
  }

  return builtInSignatures.some(
    (signature) =>
      args.length === signature.length &&
      signature.every((typeName, index) =>
        typeRefMatchesBuiltInNames(args[index] ?? null, [typeName]),
      ),
  );
};

const extractCreateOperatorDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const operatorRef = objectFromNameParts(
    "operator",
    extractNameParts(statementNode.defnames),
  );
  if (operatorRef?.schema) {
    requires.push(createObjectRefFromAst("schema", operatorRef.schema));
  }

  const definition = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  let functionNameParts: string[] = [];
  let leftArgRef: ObjectRef | null = null;
  let rightArgRef: ObjectRef | null = null;

  for (const optionNode of definition) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }

    const optionName = defElem.defname.toLowerCase();
    const typeName = asRecord(defElem.arg)?.TypeName;
    if (operatorImplementationFunctionOptionNames.has(optionName)) {
      functionNameParts = extractNameParts(asRecord(typeName)?.names);
      continue;
    }

    if (operatorEstimatorFunctionOptionNames.has(optionName)) {
      const estimatorFunctionNameParts = extractNameParts(
        asRecord(typeName)?.names,
      );
      if (isBuiltInOperatorEstimatorFunctionName(estimatorFunctionNameParts)) {
        continue;
      }

      const estimatorFunctionRef = objectRefFromNamePartsWithArgs(
        "function",
        estimatorFunctionNameParts,
        operatorEstimatorFunctionArgs(optionName) ?? [],
      );
      if (estimatorFunctionRef) {
        requires.push(estimatorFunctionRef);
      }
      continue;
    }

    if (optionName === "leftarg") {
      leftArgRef = typeFromTypeNameNode(typeName);
      if (leftArgRef) {
        requires.push(leftArgRef);
      }
      continue;
    }

    if (optionName === "rightarg") {
      rightArgRef = typeFromTypeNameNode(typeName);
      if (rightArgRef) {
        requires.push(rightArgRef);
      }
    }
  }

  const functionArgRefs = [leftArgRef, rightArgRef].filter(
    (argRef): argRef is ObjectRef => argRef !== null,
  );
  const functionSignatureParts = functionArgRefs.map(typeSignaturePart);
  const operatorSignatureParts =
    leftArgRef || rightArgRef
      ? [
          leftArgRef ? typeSignaturePart(leftArgRef) : "none",
          rightArgRef ? typeSignaturePart(rightArgRef) : "none",
        ]
      : [];

  if (operatorRef) {
    provides.push(
      createObjectRefFromAst(
        "operator",
        operatorRef.name,
        operatorRef.schema,
        operatorSignatureParts.length > 0
          ? `(${operatorSignatureParts.join(",")})`
          : undefined,
      ),
    );
  }

  const functionRef = objectFromNameParts("function", functionNameParts);
  if (
    functionRef &&
    !isBuiltInOperatorImplementationFunctionName(
      functionNameParts,
      functionArgRefs,
    )
  ) {
    requires.push(
      createObjectRefFromAst(
        "function",
        functionRef.name,
        functionRef.schema,
        functionSignatureParts.length > 0
          ? `(${functionSignatureParts.join(",")})`
          : undefined,
      ),
    );
  }

  return { provides, requires };
};

const OPCLASS_ITEM_OPERATOR = 1;
const OPCLASS_ITEM_FUNCTION = 2;
const OPCLASS_ITEM_STORAGE = 3;

const extractCreateOperatorFamilyDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const operatorFamilyRef = objectFromNameParts(
    "operator_family",
    extractNameParts(statementNode.opfamilyname),
  );
  if (operatorFamilyRef) {
    const accessMethod =
      typeof statementNode.amname === "string" ? statementNode.amname : "";
    provides.push(
      createObjectRefFromAst(
        "operator_family",
        operatorFamilyRef.name,
        operatorFamilyRef.schema,
        accessMethod || undefined,
      ),
    );
    if (operatorFamilyRef.schema) {
      requires.push(createObjectRefFromAst("schema", operatorFamilyRef.schema));
    }
  }

  return { provides, requires };
};

const extractCreateOperatorClassDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  const accessMethod =
    typeof statementNode.amname === "string" ? statementNode.amname : "";
  const operatorFamilyRef = objectFromNameParts(
    "operator_family",
    extractNameParts(statementNode.opfamilyname),
  );

  const operatorClassRef = objectFromNameParts(
    "operator_class",
    extractNameParts(statementNode.opclassname),
  );
  if (operatorClassRef) {
    provides.push(
      createObjectRefFromAst(
        "operator_class",
        operatorClassRef.name,
        operatorClassRef.schema,
        accessMethod || undefined,
      ),
    );
    if (!operatorFamilyRef) {
      provides.push(
        createObjectRefFromAst(
          "operator_family",
          operatorClassRef.name,
          operatorClassRef.schema,
          accessMethod || undefined,
        ),
      );
    }
    if (operatorClassRef.schema) {
      requires.push(createObjectRefFromAst("schema", operatorClassRef.schema));
    }
  }

  if (operatorFamilyRef) {
    // CREATE OPERATOR CLASS ... FAMILY requires the named family to exist for
    // the same access method before the class can be created.
    requires.push(
      createObjectRefFromAst(
        "operator_family",
        operatorFamilyRef.name,
        operatorFamilyRef.schema,
        accessMethod || undefined,
      ),
    );
  }

  const dataTypeRef = typeFromTypeNameNode(statementNode.datatype);
  if (dataTypeRef) {
    requires.push(dataTypeRef);
  }

  const items = Array.isArray(statementNode.items) ? statementNode.items : [];
  for (const itemNode of items) {
    const item = asRecord(asRecord(itemNode)?.CreateOpClassItem);
    if (!item) {
      continue;
    }

    const itemName = asRecord(item.name);
    const nameParts = extractNameParts(itemName?.objname);

    if (item.itemtype === OPCLASS_ITEM_OPERATOR) {
      const explicitOperatorArgs = objectWithArgsTypeRefs(itemName);
      const operatorArgs =
        explicitOperatorArgs.length > 0
          ? explicitOperatorArgs
          : dataTypeRef
            ? [dataTypeRef, dataTypeRef]
            : [];

      const orderFamilyRef = objectFromNameParts(
        "operator_family",
        extractNameParts(item.order_family),
      );
      const orderFamilyNameParts = extractNameParts(item.order_family);
      if (
        orderFamilyRef &&
        !isBuiltInBtreeOperatorFamilyName(orderFamilyNameParts)
      ) {
        requires.push(
          createObjectRefFromAst(
            "operator_family",
            orderFamilyRef.name,
            orderFamilyRef.schema,
            "(btree)",
          ),
        );
      }

      if (
        isBuiltInOperatorClassSupportOperatorName(
          nameParts,
          operatorArgs,
          dataTypeRef,
        )
      ) {
        if (nameParts.length === 1) {
          const operatorRef = objectWithArgsRef(
            "operator",
            itemName,
            operatorArgs,
          );
          if (operatorRef) {
            requires.push(markOmitIfNoLocalProducerRef(operatorRef));
          }
        }
        continue;
      }

      const operatorRef = objectWithArgsRef("operator", itemName, operatorArgs);
      if (operatorRef) {
        requires.push(operatorRef);
      }
      continue;
    }

    if (item.itemtype === OPCLASS_ITEM_FUNCTION) {
      const classArgs = Array.isArray(item.class_args) ? item.class_args : [];
      for (const classArg of classArgs) {
        const classArgRef = typeFromTypeNameNode(asRecord(classArg)?.TypeName);
        if (classArgRef) {
          requires.push(classArgRef);
        }
      }

      if (
        isBuiltInOperatorClassSupportFunctionName(
          nameParts,
          objectWithArgsTypeRefs(itemName),
        )
      ) {
        continue;
      }

      const functionRef = objectWithArgsRef("function", itemName);
      if (functionRef) {
        requires.push(markExactSignatureRef(functionRef));
      }
      continue;
    }

    if (item.itemtype === OPCLASS_ITEM_STORAGE) {
      const storageTypeRef = typeFromTypeNameNode(item.storedtype);
      if (storageTypeRef) {
        requires.push(storageTypeRef);
      }
    }
  }

  return { provides, requires };
};

const baseTypeFunctionArgs = (
  optionName: string,
  typeRef: ObjectRef | null,
): ObjectRef[] | null => {
  if (!typeRef) {
    return null;
  }

  if (optionName === "input") {
    return [createObjectRefFromAst("type", "cstring")];
  }

  if (optionName === "output") {
    return [typeRef];
  }

  if (optionName === "receive") {
    return [createObjectRefFromAst("type", "internal")];
  }

  if (optionName === "send") {
    return [typeRef];
  }

  if (optionName === "typmod_in") {
    return [createObjectRefFromAst("type", "cstring[]")];
  }

  if (optionName === "typmod_out") {
    return [createObjectRefFromAst("type", "int4")];
  }

  if (optionName === "analyze" || optionName === "subscript") {
    return [createObjectRefFromAst("type", "internal")];
  }

  return null;
};

const extractCreateBaseTypeDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const typeRef = objectFromNameParts(
    "type",
    extractNameParts(statementNode.defnames),
  );
  if (typeRef) {
    provides.push(createObjectRefFromAst("type", typeRef.name, typeRef.schema));
    if (typeRef.schema) {
      requires.push(createObjectRefFromAst("schema", typeRef.schema));
    }
  }

  const definition = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  for (const optionNode of definition) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }

    const optionName = defElem.defname.toLowerCase();
    if (baseTypeTypeOptionNames.has(optionName)) {
      const typeRef = typeFromTypeNameNode(asRecord(defElem.arg)?.TypeName);
      if (typeRef) {
        requires.push(typeRef);
      }
      continue;
    }

    if (!baseTypeFunctionOptionNames.has(optionName)) {
      continue;
    }

    const functionTypeName = asRecord(asRecord(defElem.arg)?.TypeName);
    const functionRef = objectFromNameParts(
      "function",
      extractNameParts(functionTypeName?.names),
    );
    if (functionRef) {
      requires.push(
        markExactSignatureRef(
          createObjectRefFromAst(
            "function",
            functionRef.name,
            functionRef.schema,
            typeRefsSignature(baseTypeFunctionArgs(optionName, typeRef) ?? []),
          ),
        ),
      );
    }
  }

  return { provides, requires };
};

const aggregateFunctionOptionNames = new Set([
  "sfunc",
  "finalfunc",
  "combinefunc",
  "serialfunc",
  "deserialfunc",
  "msfunc",
  "minvfunc",
  "mfinalfunc",
]);

const aggregateTypeOptionNames = new Set(["stype", "mstype"]);

const extractCreateAggregateDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const aggregateRef = objectFromNameParts(
    "aggregate",
    extractNameParts(statementNode.defnames),
  );
  const args = Array.isArray(statementNode.args) ? statementNode.args : [];
  const argList = asRecord(asRecord(args[0])?.List);
  const argItems = Array.isArray(argList?.items) ? argList.items : [];
  const signatureParts: string[] = [];
  for (const argNode of argItems) {
    const functionParameter = asRecord(asRecord(argNode)?.FunctionParameter);
    const argType = typeFromTypeNameNode(functionParameter?.argType);
    if (argType) {
      requires.push(argType);
      signatureParts.push(
        argType.schema ? `${argType.schema}.${argType.name}` : argType.name,
      );
    }
  }

  if (aggregateRef) {
    provides.push(
      createObjectRefFromAst(
        "aggregate",
        aggregateRef.name,
        aggregateRef.schema,
        signatureParts.length > 0 ? `(${signatureParts.join(",")})` : "()",
      ),
    );
    if (aggregateRef.schema) {
      requires.push(createObjectRefFromAst("schema", aggregateRef.schema));
    }
  }

  const options = Array.isArray(statementNode.definition)
    ? statementNode.definition
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem || typeof defElem.defname !== "string") {
      continue;
    }
    const optionName = defElem.defname.toLowerCase();

    if (aggregateFunctionOptionNames.has(optionName)) {
      const functionTypeName = asRecord(asRecord(defElem.arg)?.TypeName);
      const functionRef = objectFromNameParts(
        "function",
        extractNameParts(functionTypeName?.names),
      );
      if (functionRef) {
        requires.push(functionRef);
      }
      continue;
    }

    if (aggregateTypeOptionNames.has(optionName)) {
      const typeRef = typeFromTypeNameNode(asRecord(defElem.arg)?.TypeName);
      if (typeRef) {
        requires.push(typeRef);
      }
    }
  }

  return { provides, requires };
};

const extractAlterSequenceDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const sequenceRef = relationFromRangeVarNode(
    statementNode.sequence,
    "sequence",
  );
  if (sequenceRef) {
    requires.push(sequenceRef);
  }

  const options = Array.isArray(statementNode.options)
    ? statementNode.options
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (defElem?.defname !== "owned_by") {
      continue;
    }

    const listItems = asRecord(defElem.arg)?.List;
    const nameParts = extractNameParts(asRecord(listItems)?.items);
    if (nameParts.length >= 2) {
      const tableRef = objectFromNameParts("table", nameParts.slice(0, 2));
      if (tableRef) {
        requires.push(tableRef);
      }
    }
  }

  return { provides, requires };
};

const extractSelectDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];
  addExpressionDependencies(statementNode, requires);
  return { provides, requires };
};

const extractUpdateDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const relationRef = relationFromRangeVarNode(statementNode.relation, "table");
  if (relationRef) {
    requires.push(relationRef);
  }

  addExpressionDependencies(statementNode.targetList, requires);
  addExpressionDependencies(statementNode.whereClause, requires);

  return { provides, requires };
};

const extractAlterDefaultPrivilegesDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const options = Array.isArray(statementNode.options)
    ? statementNode.options
    : [];
  for (const optionNode of options) {
    const defElem = asRecord(asRecord(optionNode)?.DefElem);
    if (!defElem) {
      continue;
    }

    if (defElem.defname === "roles") {
      const roleItems = asRecord(asRecord(defElem.arg)?.List)?.items;
      const roles = Array.isArray(roleItems) ? roleItems : [];
      for (const roleNode of roles) {
        const roleName = roleNameFromRoleSpec(asRecord(roleNode)?.RoleSpec);
        if (roleName) {
          requires.push(createObjectRefFromAst("role", roleName));
        }
      }
    }

    if (defElem.defname === "schemas") {
      const schemaItems = asRecord(asRecord(defElem.arg)?.List)?.items;
      const names = extractNameParts(schemaItems);
      for (const schemaName of names) {
        requires.push(createObjectRefFromAst("schema", schemaName));
      }
    }
  }

  const action = asRecord(statementNode.action);
  const granteeItems = Array.isArray(action?.grantees) ? action.grantees : [];
  for (const granteeNode of granteeItems) {
    const roleName = roleNameFromRoleSpec(asRecord(granteeNode)?.RoleSpec);
    if (roleName) {
      requires.push(createObjectRefFromAst("role", roleName));
    }
  }

  return { provides, requires };
};

const extractDoDependencies = (
  statementNode: Record<string, unknown>,
): ExtractDependenciesResult => {
  const provides: ObjectRef[] = [];
  const requires: ObjectRef[] = [];

  const args = Array.isArray(statementNode.args) ? statementNode.args : [];
  let body = "";
  for (const argNode of args) {
    const defElem = asRecord(asRecord(argNode)?.DefElem);
    if (defElem?.defname !== "as") {
      continue;
    }
    const text = extractStringValue(defElem.arg);
    if (text) {
      body = text;
      break;
    }
  }

  if (body.length === 0) {
    return { provides, requires };
  }

  const createTypeRegex = /create\s+type\s+([a-zA-Z0-9_."-]+)\s+as\s+enum/giu;
  for (const match of body.matchAll(createTypeRegex)) {
    const qualifiedName = match[1];
    if (!qualifiedName) {
      continue;
    }
    const { schema, name } = splitQualifiedName(qualifiedName, "raw");
    if (!name) {
      continue;
    }

    provides.push(createObjectRef("type", name, schema));
    if (schema) {
      requires.push(createObjectRef("schema", schema));
    }
  }

  return { provides, requires };
};

const extractDependencyRefs = (
  statementClass: StatementClass,
  ast: unknown,
): ExtractDependenciesResult => {
  const astNode = asRecord(ast);
  if (!astNode) {
    return { provides: [], requires: [] };
  }

  switch (statementClass) {
    case "CREATE_SCHEMA": {
      const createSchema = asRecord(astNode.CreateSchemaStmt);
      const name =
        typeof createSchema?.schemaname === "string"
          ? createSchema.schemaname
          : undefined;
      return {
        provides: name ? [createObjectRefFromAst("schema", name)] : [],
        requires: [],
      };
    }
    case "CREATE_LANGUAGE":
      return extractCreateLanguageDependencies(
        asRecord(astNode.CreatePLangStmt) ?? {},
      );
    case "CREATE_EXTENSION": {
      const createExtension = asRecord(astNode.CreateExtensionStmt);
      const extensionName =
        typeof createExtension?.extname === "string"
          ? createExtension.extname
          : undefined;
      let schemaName: string | undefined;
      const options = Array.isArray(createExtension?.options)
        ? createExtension.options
        : [];
      for (const optionNode of options) {
        const defElem = asRecord(asRecord(optionNode)?.DefElem);
        if (defElem?.defname !== "schema") {
          continue;
        }
        const optionValue = extractStringValue(defElem.arg);
        if (optionValue) {
          schemaName = optionValue;
        }
      }
      return {
        provides: extensionName
          ? [createObjectRefFromAst("extension", extensionName, schemaName)]
          : [],
        requires: schemaName
          ? [createObjectRefFromAst("schema", schemaName)]
          : [],
      };
    }
    case "CREATE_FOREIGN_DATA_WRAPPER":
      return extractCreateForeignDataWrapperDependencies(
        asRecord(astNode.CreateFdwStmt) ?? {},
      );
    case "CREATE_FOREIGN_SERVER":
      return extractCreateForeignServerDependencies(
        asRecord(astNode.CreateForeignServerStmt) ?? {},
      );
    case "CREATE_TYPE": {
      const defineStmt = asRecord(astNode.DefineStmt);
      if (defineStmt?.kind === "OBJECT_TYPE") {
        if (
          Array.isArray(defineStmt.definition) &&
          defineStmt.definition.length > 0
        ) {
          return extractCreateBaseTypeDependencies(defineStmt);
        }

        const shellTypeRef = objectFromNameParts(
          "type",
          extractNameParts(defineStmt.defnames),
        );
        return {
          provides: shellTypeRef
            ? [
                createObjectRefFromAst(
                  "type",
                  shellTypeRef.name,
                  shellTypeRef.schema,
                  SHELL_TYPE_SIGNATURE,
                ),
              ]
            : [],
          requires: shellTypeRef?.schema
            ? [createObjectRefFromAst("schema", shellTypeRef.schema)]
            : [],
        };
      }

      const compositeType = asRecord(astNode.CompositeTypeStmt);
      const compositeRef = relationFromRangeVarNode(
        compositeType?.typevar,
        "type",
      );
      const enumStmt = asRecord(astNode.CreateEnumStmt);
      const enumRef = objectFromNameParts(
        "type",
        extractNameParts(enumStmt?.typeName),
      );
      const rangeStmt = asRecord(astNode.CreateRangeStmt);
      const rangeDependencies = rangeStmt
        ? extractCreateRangeDependencies(rangeStmt)
        : null;
      const typeRef = compositeRef ?? enumRef;
      if (rangeDependencies) {
        return rangeDependencies;
      }
      return {
        provides: typeRef
          ? [createObjectRefFromAst("type", typeRef.name, typeRef.schema)]
          : [],
        requires: typeRef?.schema
          ? [createObjectRefFromAst("schema", typeRef.schema)]
          : [],
      };
    }
    case "CREATE_ROLE": {
      const createRole = asRecord(astNode.CreateRoleStmt);
      const roleName =
        typeof createRole?.role === "string" ? createRole.role : undefined;
      return {
        provides: roleName ? [createObjectRefFromAst("role", roleName)] : [],
        requires: [],
      };
    }
    case "CREATE_PUBLICATION":
      return extractCreatePublicationDependencies(
        asRecord(astNode.CreatePublicationStmt) ?? {},
      );
    case "ALTER_PUBLICATION":
      return extractAlterPublicationDependencies(
        asRecord(astNode.AlterPublicationStmt) ?? {},
      );
    case "CREATE_SUBSCRIPTION":
      return extractCreateSubscriptionDependencies(
        asRecord(astNode.CreateSubscriptionStmt) ?? {},
      );
    case "ALTER_SUBSCRIPTION":
      return extractAlterSubscriptionDependencies(
        asRecord(astNode.AlterSubscriptionStmt) ?? {},
      );
    case "CREATE_DOMAIN": {
      const createDomain = asRecord(astNode.CreateDomainStmt);
      const nameParts = extractNameParts(createDomain?.domainname);
      const domainRef = objectFromNameParts("domain", nameParts);
      const typeRef = typeFromTypeNameNode(createDomain?.typeName);
      const requires: ObjectRef[] = typeRef ? [typeRef] : [];

      const constraints = Array.isArray(createDomain?.constraints)
        ? createDomain.constraints
        : [];
      for (const constraintItem of constraints) {
        const constraint = asRecord(asRecord(constraintItem)?.Constraint);
        if (constraint?.raw_expr) {
          addExpressionDependencies(constraint.raw_expr, requires);
        }
      }

      return {
        provides: domainRef ? [domainRef] : [],
        requires,
      };
    }
    case "CREATE_SEQUENCE": {
      const createSequence = asRecord(astNode.CreateSeqStmt);
      const sequenceRangeVar = asRecord(createSequence?.sequence);
      const sequenceRef = relationFromRangeVarNode(
        sequenceRangeVar,
        "sequence",
      );
      return {
        provides: sequenceRef
          ? [
              createObjectRefFromAst(
                "sequence",
                sequenceRef.name,
                sequenceRef.schema,
              ),
            ]
          : [],
        requires: sequenceRef?.schema
          ? [createObjectRefFromAst("schema", sequenceRef.schema)]
          : [],
      };
    }
    case "ALTER_SEQUENCE":
      return extractAlterSequenceDependencies(
        asRecord(astNode.AlterSeqStmt) ?? {},
      );
    case "CREATE_TABLE":
      if (asRecord(astNode.CreateStmt)) {
        return extractCreateTableDependencies(
          asRecord(astNode.CreateStmt) ?? {},
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "table",
        );
      }
      return { provides: [], requires: [] };
    case "ALTER_TABLE":
      return extractAlterTableDependencies(
        asRecord(astNode.AlterTableStmt) ?? {},
      );
    case "CREATE_INDEX": {
      const indexStmt = asRecord(astNode.IndexStmt);
      const relationRef = relationFromRangeVarNode(
        indexStmt?.relation,
        "table",
      );
      const indexRef =
        typeof indexStmt?.idxname === "string"
          ? createObjectRefFromAst(
              "index",
              indexStmt.idxname,
              relationRef?.schema,
            )
          : null;
      const uniqueKeyProvides: ObjectRef[] = [];

      const isUnique = indexStmt?.unique === true;
      const hasPredicate = Boolean(indexStmt?.whereClause);
      if (isUnique && relationRef && !hasPredicate) {
        const indexParams = Array.isArray(indexStmt?.indexParams)
          ? indexStmt.indexParams
          : [];
        const indexColumns: string[] = [];
        let allColumnsNamed = true;
        for (const paramNode of indexParams) {
          const indexElem = asRecord(asRecord(paramNode)?.IndexElem);
          if (!indexElem) {
            allColumnsNamed = false;
            break;
          }
          if (typeof indexElem.name !== "string") {
            allColumnsNamed = false;
            break;
          }
          indexColumns.push(indexElem.name);
        }

        if (allColumnsNamed && indexColumns.length > 0) {
          const providedKey = keyRefForTableColumns(relationRef, indexColumns);
          if (providedKey) {
            uniqueKeyProvides.push(providedKey);
          }
        }
      }

      return {
        provides: dedupeObjectRefs([
          ...(indexRef ? [indexRef] : []),
          ...uniqueKeyProvides,
        ]),
        requires: relationRef ? [relationRef] : [],
      };
    }
    case "CREATE_OPERATOR":
      return extractCreateOperatorDependencies(
        asRecord(astNode.DefineStmt) ?? {},
      );
    case "CREATE_OPERATOR_CLASS":
      return extractCreateOperatorClassDependencies(
        asRecord(astNode.CreateOpClassStmt) ?? {},
      );
    case "CREATE_OPERATOR_FAMILY":
      return extractCreateOperatorFamilyDependencies(
        asRecord(astNode.CreateOpFamilyStmt) ?? {},
      );
    case "CREATE_FUNCTION":
      return extractCreateFunctionDependencies(
        asRecord(astNode.CreateFunctionStmt) ?? {},
        "function",
      );
    case "CREATE_PROCEDURE":
      return extractCreateFunctionDependencies(
        asRecord(astNode.CreateFunctionStmt) ?? {},
        "procedure",
      );
    case "CREATE_AGGREGATE":
      return extractCreateAggregateDependencies(
        asRecord(astNode.DefineStmt) ?? {},
      );
    case "CREATE_COLLATION":
      return extractCreateCollationDependencies(
        asRecord(astNode.DefineStmt) ?? {},
      );
    case "CREATE_VIEW":
      return extractViewDependencies(asRecord(astNode.ViewStmt) ?? {}, "view");
    case "CREATE_MATERIALIZED_VIEW":
      if (asRecord(astNode.ViewStmt)) {
        return extractViewDependencies(
          asRecord(astNode.ViewStmt) ?? {},
          "materialized_view",
        );
      }
      if (asRecord(astNode.CreateTableAsStmt)) {
        return extractCreateTableAsDependencies(
          asRecord(astNode.CreateTableAsStmt) ?? {},
          "materialized_view",
        );
      }
      return { provides: [], requires: [] };
    case "CREATE_TRIGGER":
      return extractTriggerDependencies(asRecord(astNode.CreateTrigStmt) ?? {});
    case "CREATE_RULE":
      return extractRuleDependencies(asRecord(astNode.RuleStmt) ?? {});
    case "CREATE_EVENT_TRIGGER":
      return extractCreateEventTriggerDependencies(
        asRecord(astNode.CreateEventTrigStmt) ?? {},
      );
    case "CREATE_POLICY":
      return extractPolicyDependencies(
        asRecord(astNode.CreatePolicyStmt) ?? {},
      );
    case "GRANT":
    case "REVOKE":
      return extractGrantDependencies(asRecord(astNode.GrantStmt) ?? {});
    case "ALTER_DEFAULT_PRIVILEGES":
      return extractAlterDefaultPrivilegesDependencies(
        asRecord(astNode.AlterDefaultPrivilegesStmt) ?? {},
      );
    case "SELECT":
      return extractSelectDependencies(asRecord(astNode.SelectStmt) ?? {});
    case "UPDATE":
      return extractUpdateDependencies(asRecord(astNode.UpdateStmt) ?? {});
    case "DO":
      return extractDoDependencies(asRecord(astNode.DoStmt) ?? {});
    case "VARIABLE_SET":
      return { provides: [], requires: [] };
    case "COMMENT":
      return extractCommentDependencies(asRecord(astNode.CommentStmt) ?? {});
    case "ALTER_OWNER":
      return extractAlterOwnerDependencies(
        asRecord(astNode.AlterOwnerStmt) ?? {},
      );
    case "UNKNOWN":
      return { provides: [], requires: [] };
  }
};

// When a pg-topo:requires annotation specifies a concrete signature for an
// object, any body-extracted requirement for the same kind:schema:name with an
// ambiguous (unknown-containing) signature is redundant. Keeping both would
// cause the ambiguous ref to trigger false-positive matching in the graph
// builder (e.g. cycle detection on overloaded functions). This filter removes
// the extracted refs that the annotations supersede.
const filterSupersededRequires = (
  extractedRequires: ObjectRef[],
  annotationRequires: ObjectRef[],
): ObjectRef[] => {
  if (annotationRequires.length === 0) {
    return extractedRequires;
  }
  const annotatedBaseKeys = new Set(
    annotationRequires
      .filter((ref) => ref.signature && !ref.signature.includes("unknown"))
      .map((ref) => `${ref.kind}:${ref.schema ?? ""}:${ref.name}`),
  );
  if (annotatedBaseKeys.size === 0) {
    return extractedRequires;
  }
  return extractedRequires.filter((ref) => {
    if (!ref.signature?.includes("unknown")) {
      return true;
    }
    const baseKey = `${ref.kind}:${ref.schema ?? ""}:${ref.name}`;
    return !annotatedBaseKeys.has(baseKey);
  });
};

export const extractDependencies = (
  statementClass: StatementClass,
  ast: unknown,
  annotations: AnnotationHints,
): ExtractDependenciesResult => {
  const extracted = extractDependencyRefs(statementClass, ast);
  return {
    provides: dedupeObjectRefs([
      ...extracted.provides,
      ...annotations.provides,
    ]),
    requires: dedupeObjectRefs([
      ...filterSupersededRequires(extracted.requires, annotations.requires),
      ...annotations.requires,
      ...annotations.dependsOn,
    ]),
  };
};
