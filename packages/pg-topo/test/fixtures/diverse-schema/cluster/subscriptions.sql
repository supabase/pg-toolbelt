create subscription app_subscription
    connection 'dbname=postgres'
    publication app_publication
    with (
        enabled = false,
        connect = false,
        create_slot = false,
        copy_data = false
    );
