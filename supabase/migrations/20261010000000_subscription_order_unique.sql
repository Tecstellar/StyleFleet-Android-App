-- One paid Cashfree order can activate one subscription.
-- The payment function already checks before inserting; this makes the database refuse a duplicate
-- even if two requests arrive at the same moment.
--
-- Older payments could have been saved twice (the app and the server each inserted a row), and such
-- duplicates would make the unique index impossible to build. This script never deletes anything:
-- if duplicates exist it lists them and leaves the index out, so they can be reviewed first.

do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select cashfree_order_id
    from public.subscriptions
    where cashfree_order_id is not null
    group by cashfree_order_id
    having count(*) > 1
  ) d;

  if dup_count = 0 then
    create unique index if not exists idx_subscriptions_cashfree_order_unique
      on public.subscriptions (cashfree_order_id)
      where cashfree_order_id is not null;
  else
    raise notice 'Skipped unique index: % order(s) have more than one subscription row. Review them with: select cashfree_order_id, count(*) from public.subscriptions where cashfree_order_id is not null group by 1 having count(*) > 1;', dup_count;
  end if;
end $$;
