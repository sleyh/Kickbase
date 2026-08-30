-- Enables Supabase Realtime on the two tables the dashboard wants to
-- react to live: job_runs (so a job started elsewhere - the admin
-- section's "run now", or eventually a cron dispatcher - shows up
-- without a manual refresh) and reports_cache (so a freshly generated
-- report replaces stale numbers on screen automatically). RLS still
-- applies to Realtime subscriptions the same as any other read, so a
-- client only ever receives change events for rows it could already
-- SELECT.
alter publication supabase_realtime add table public.job_runs;
alter publication supabase_realtime add table public.reports_cache;
