ALTER TABLE s.orders ADD CONSTRAINT orders_uid_fkey FOREIGN KEY (uid) REFERENCES s.users (id);
