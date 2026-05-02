/**
 * Check if a stable ID represents metadata (ACL, default privileges, comments, etc.)
 * rather than an actual database object.
 */
export function isMetadataStableId(stableId: string): boolean {
  return (
    stableId.startsWith("acl:") ||
    stableId.startsWith("defacl:") ||
    stableId.startsWith("aclcol:") ||
    stableId.startsWith("membership:") ||
    stableId.startsWith("comment:")
  );
}
