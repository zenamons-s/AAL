# Database Migrations

SQL migration files for database schema initialization.

## Files

- `001_create_users_table.sql` - Creates users table
- `002_create_orders_tables.sql` - Creates orders, order_passengers, order_services, and user_preferences tables
- `003_optimized_storage_schema.sql` - Creates tables for stops, routes, flights, virtual entities, and metadata
- `004_add_composite_indexes.sql` - Adds composite indexes for frequent query patterns
- `005_add_ferry_transport_type.sql` - Adds FERRY to transport_type CHECK constraint in routes table
- `006_extend_id_fields_to_varchar100.sql` - Extends routes.id, flights.id, virtual_routes.id, flights.route_id from VARCHAR(50) to VARCHAR(100)
- `007_cleanup_virtual_data_and_invalid_references.sql` - Cleans up all virtual stops/routes, invalid references, and old generated data for clean rebuild
- `008_cleanup_virtual_stops_from_stops_table.sql` - Removes all virtual stops from stops table (extension of Migration 007). Deletes virtual stops with invalid IDs, empty city_id, or empty name. Ensures virtual stops exist only in virtual_stops table, not in stops table. Apply after Migration 007, before running data initialization pipeline.
- `009_update_ferry_terminal_metadata.sql` - Updates metadata.type = 'ferry_terminal' for stop-027 and stop-028. Ensures GraphBuilderWorker can correctly identify ferry terminals. Apply after Migration 008, before running data initialization pipeline.

## Usage

Migrations are automatically run on backend startup via `init-db.ts`.



