import type { DatabaseLikeError } from "./postgres-types";
import type { StatementNode } from "../../../src/model/types";

export const toDatabaseLikeError = (error: unknown): DatabaseLikeError => {
  if (!error || typeof error !== "object") {
    return {};
  }

  const record = error as Record<string, unknown>;
  const rawCode = typeof record.code === "string" ? record.code : undefined;
  const rawErrno = typeof record.errno === "string" ? record.errno : undefined;
  const sqlstate =
    rawCode && rawCode.startsWith("ERR_") ? (rawErrno ?? rawCode) : (rawCode ?? rawErrno);
  return {
    code: sqlstate,
    message: typeof record.message === "string" ? record.message : undefined,
  };
};

export const isDependencyErrorCode = (code: string | undefined): boolean =>
  code === "42P01" || code === "42703" || code === "42704" || code === "42883" || code === "3F000";

const isExtensionUnavailableError = (
  error: DatabaseLikeError,
  statementNode: StatementNode,
): boolean => {
  if (statementNode.statementClass !== "CREATE_EXTENSION") {
    return false;
  }

  const code = error.code;
  const message = (error.message ?? "").toLowerCase();
  if (code === "58P01" || code === "0A000") {
    return true;
  }

  return (
    message.includes("extension") &&
    (message.includes("control file") ||
      message.includes("is not available") ||
      message.includes("could not open"))
  );
};

export const isEnvironmentCapabilityError = (
  error: DatabaseLikeError,
  statementNode: StatementNode,
): boolean => {
  if (error.code === "0A000") {
    return true;
  }

  if (isExtensionUnavailableError(error, statementNode)) {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  if (message.includes("extension") && message.includes("is not available")) {
    return true;
  }

  if (
    statementNode.statementClass === "CREATE_SUBSCRIPTION" &&
    (error.code === "58P01" ||
      message.includes("walreceiver") ||
      message.includes("logical replication"))
  ) {
    return true;
  }

  if (
    statementNode.statementClass === "CREATE_EVENT_TRIGGER" &&
    (error.code === "42501" || message.includes("must be superuser"))
  ) {
    return true;
  }

  if (
    (statementNode.statementClass === "CREATE_FUNCTION" ||
      statementNode.statementClass === "CREATE_PROCEDURE") &&
    message.includes("language") &&
    message.includes("does not exist")
  ) {
    return true;
  }

  if (
    error.code === "55000" &&
    message.includes("sequence must have same owner as table it is linked to")
  ) {
    return true;
  }

  if (
    error.code === "55000" &&
    message.includes("does not have a replica identity") &&
    message.includes("publishes updates")
  ) {
    return true;
  }

  if (
    statementNode.statementClass === "CREATE_ROLE" &&
    error.code === "42710" &&
    message.includes("role") &&
    message.includes("already exists")
  ) {
    return true;
  }

  if (
    statementNode.statementClass === "CREATE_ROLE" &&
    error.code === "23505" &&
    (message.includes("pg_authid_rolname_index") ||
      (message.includes("duplicate key") && message.includes("rolname")))
  ) {
    return true;
  }

  return false;
};
