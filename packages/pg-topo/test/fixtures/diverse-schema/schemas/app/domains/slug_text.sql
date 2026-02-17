create domain app.slug_text as text
    check (value ~ '^[a-z0-9-]+$');
