-- Removing a label rebuilds the enum; the rebuilt type must keep PUBLIC's
-- USAGE revoked.
CREATE TYPE mood AS ENUM ('sad');
REVOKE USAGE ON TYPE mood FROM PUBLIC;
