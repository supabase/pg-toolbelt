INSERT INTO test_schema.widgets (id, status, history) VALUES
  (1, 'active', ARRAY['draft', 'active']::test_schema.widget_status[]);
