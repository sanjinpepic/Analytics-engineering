/**
 * The reference Tidepool dbt project — what is merged on `main` and built into the `prod` schema.
 * Workday tasks and exercises start from this and override individual files.
 */
import type { ProjectFiles } from './types';

export const TIDEPOOL_PROJECT: ProjectFiles = {
  'dbt_project.yml': `name: tidepool
version: '1.0.0'
profile: tidepool

vars:
  reporting_start_date: '2025-01-01'

models:
  tidepool:
    staging:
      +materialized: view
    intermediate:
      +materialized: view
    marts:
      +materialized: table
`,

  'models/staging/_sources.yml': `version: 2

sources:
  - name: shop
    description: Production Postgres of the web shop, replicated by the EL tool.
    schema: raw
    tables:
      - name: customers
        description: One row per change to a customer (CDC).
        loaded_at_field: _loaded_at
        freshness:
          warn_after: {count: 24, period: hour}
          error_after: {count: 72, period: hour}
      - name: orders
        description: Orders; the connector can re-deliver rows.
        loaded_at_field: _loaded_at
        freshness:
          warn_after: {count: 12, period: hour}
          error_after: {count: 24, period: hour}
      - name: order_items
      - name: products
      - name: payments
      - name: subscriptions

  - name: segment
    schema: raw
    tables:
      - name: events
        loaded_at_field: _loaded_at
        freshness:
          warn_after: {count: 6, period: hour}
          error_after: {count: 24, period: hour}

  - name: finance
    schema: raw
    tables:
      - name: fx_rates
        description: Business-day FX rates, no USD row.

  - name: ads
    schema: raw
    tables:
      - name: marketing_spend
`,

  'models/staging/stg_shop__customers.sql': `with source as (

    select * from {{ source('shop', 'customers') }}

),

latest as (

    -- raw.customers is CDC history: keep the latest version of each customer
    select *
    from source
    qualify row_number() over (partition by id order by updated_at desc, _loaded_at desc) = 1

)

select
    id                                   as customer_id,
    first_name,
    last_name,
    lower(trim(email))                   as email,
    country                              as country_code,
    signup_source,
    created_at,
    updated_at,
    lower(trim(email)) like '%@tidepool.test' as is_test_account
from latest
`,

  'models/staging/stg_shop__orders.sql': `with source as (

    select * from {{ source('shop', 'orders') }}

),

deduplicated as (

    -- the connector re-delivers rows; the latest load is the truth
    select *
    from source
    qualify row_number() over (partition by id order by _loaded_at desc) = 1

)

select
    id                       as order_id,
    customer_id,
    ordered_at,
    cast(ordered_at as date) as order_date,
    status                   as order_status,
    currency,
    shipping_cents,
    discount_code,
    discount_cents,
    _loaded_at
from deduplicated
`,

  'models/staging/stg_shop__order_items.sql': `select
    id                           as order_item_id,
    order_id,
    product_id,
    quantity,
    unit_price_cents,
    quantity * unit_price_cents  as line_amount_cents
from {{ source('shop', 'order_items') }}
`,

  'models/staging/stg_shop__products.sql': `select
    id                       as product_id,
    name                     as product_name,
    category,
    price_usd_cents / 100.0  as list_price_usd,
    launched_at
from {{ source('shop', 'products') }}
`,

  'models/staging/stg_shop__payments.sql': `select
    id              as payment_id,
    order_id,
    payment_method,
    status          as payment_status,
    amount_cents,
    created_at
from {{ source('shop', 'payments') }}
`,

  'models/staging/stg_shop__subscriptions.sql': `select
    id            as subscription_id,
    customer_id,
    plan,
    amount_cents,
    currency,
    started_at,
    cancelled_at
from {{ source('shop', 'subscriptions') }}
`,

  'models/staging/stg_segment__events.sql': `select
    event_id,
    anonymous_id,
    user_id       as customer_id,
    event_name,
    event_ts,
    page_path,
    utm_source,
    device,
    _loaded_at
from {{ source('segment', 'events') }}
`,

  'models/staging/stg_finance__fx_rates.sql': `with rates as (

    select rate_date, currency, usd_per_unit
    from {{ source('finance', 'fx_rates') }}

)

select * from rates

union all

-- finance only publishes foreign currencies; USD is always 1.0
select distinct rate_date, 'USD' as currency, 1.0 as usd_per_unit
from rates
`,

  'models/staging/stg_ads__marketing_spend.sql': `select
    spend_date,
    channel,
    spend_usd
from {{ source('ads', 'marketing_spend') }}
`,

  'models/staging/_staging.yml': `version: 2

models:
  - name: stg_shop__customers
    description: One row per customer (latest CDC version). Emails normalised.
    columns:
      - name: customer_id
        data_tests: [unique, not_null]
      - name: signup_source
        data_tests:
          - accepted_values:
              arguments:
                values: [organic, paid_search, paid_social, referral, partner]

  - name: stg_shop__orders
    description: One row per order (re-delivered rows removed).
    columns:
      - name: order_id
        data_tests: [unique, not_null]
      - name: order_status
        data_tests:
          - accepted_values:
              arguments:
                values: [placed, shipped, completed, returned, cancelled]

  - name: stg_shop__order_items
    columns:
      - name: order_item_id
        data_tests: [unique, not_null]

  - name: stg_shop__payments
    columns:
      - name: payment_id
        data_tests: [unique, not_null]
`,

  'models/intermediate/int_orders__amounts.sql': `with orders as (

    select * from {{ ref('stg_shop__orders') }}

),

items as (

    select
        order_id,
        sum(line_amount_cents) as subtotal_cents,
        sum(quantity)          as item_count
    from {{ ref('stg_shop__order_items') }}
    group by 1

)

select
    orders.*,
    coalesce(items.subtotal_cents, 0)                                              as subtotal_cents,
    coalesce(items.item_count, 0)                                                  as item_count,
    coalesce(items.subtotal_cents, 0) + orders.shipping_cents - orders.discount_cents as total_cents
from orders
left join items using (order_id)
`,

  'models/marts/fct_orders.sql': `{{ config(materialized='table') }}

with orders as (

    select * from {{ ref('int_orders__amounts') }}

),

fx as (

    select * from {{ ref('stg_finance__fx_rates') }}

),

customers as (

    select customer_id, is_test_account from {{ ref('stg_shop__customers') }}

)

select
    orders.order_id,
    orders.customer_id,
    orders.ordered_at,
    orders.order_date,
    orders.order_status,
    orders.currency,
    orders.item_count,
    orders.discount_code,
    orders.total_cents / 100.0                              as amount_local,
    round(orders.total_cents / 100.0 * fx.usd_per_unit, 2)  as amount_usd,
    coalesce(customers.is_test_account, false)              as is_test_account,
    row_number() over (
        partition by orders.customer_id
        order by orders.ordered_at, orders.order_id
    )                                                       as customer_order_number
from orders
-- weekend orders take the most recent business-day rate
asof left join fx
    on orders.currency = fx.currency
    and orders.order_date >= fx.rate_date
left join customers
    on orders.customer_id = customers.customer_id
`,

  'models/marts/fct_order_items.sql': `select
    items.order_item_id,
    items.order_id,
    items.product_id,
    items.quantity,
    items.line_amount_cents / 100.0 as line_amount_local,
    orders.ordered_at,
    orders.order_status,
    orders.currency
from {{ ref('stg_shop__order_items') }} as items
inner join {{ ref('stg_shop__orders') }} as orders using (order_id)
`,

  'models/marts/dim_products.sql': `select * from {{ ref('stg_shop__products') }}
`,

  'models/marts/dim_customers.sql': `with customers as (

    select * from {{ ref('stg_shop__customers') }}

),

orders as (

    select * from {{ ref('fct_orders') }}
    where order_status != 'cancelled'

),

customer_orders as (

    select
        customer_id,
        min(ordered_at)                                              as first_order_at,
        max(ordered_at)                                              as last_order_at,
        count(*)                                                     as total_orders,
        sum(case when order_status = 'completed' then amount_usd end) as lifetime_value_usd
    from orders
    group by 1

)

select
    customers.customer_id,
    customers.email,
    customers.country_code,
    customers.signup_source,
    customers.created_at,
    customers.is_test_account,
    customer_orders.first_order_at,
    customer_orders.last_order_at,
    coalesce(customer_orders.total_orders, 0)          as total_orders,
    coalesce(customer_orders.lifetime_value_usd, 0)    as lifetime_value_usd
from customers
left join customer_orders using (customer_id)
`,

  'models/marts/_marts.yml': `version: 2

models:
  - name: fct_orders
    description: >
      One row per order. amount_usd uses the latest business-day FX rate on or before
      the order date. Includes every status; filter order_status yourself.
    columns:
      - name: order_id
        description: Primary key.
        data_tests: [unique, not_null]
      - name: customer_order_number
        description: 1 for the customer's first order (any status), 2 for the second, ...

  - name: dim_customers
    description: One row per customer with lifetime order stats (cancelled orders excluded).
    columns:
      - name: customer_id
        data_tests: [unique, not_null]
      - name: lifetime_value_usd
        description: Sum of completed orders in USD.

  - name: dim_products
    columns:
      - name: product_id
        data_tests: [unique, not_null]

  - name: fct_order_items
    columns:
      - name: order_item_id
        data_tests: [unique, not_null]
`,

  'macros/cents_to_dollars.sql': `{% macro cents_to_dollars(column_name, scale=2) -%}
    round({{ column_name }} / 100.0, {{ scale }})
{%- endmacro %}
`,

  'tests/assert_no_negative_order_amounts.sql': `-- singular test: an order's total can never be negative
select order_id, amount_local
from {{ ref('fct_orders') }}
where amount_local < 0
`,
};

/** Files that make up a typical file tree, ordered for display. */
export function sortedPaths(files: ProjectFiles): string[] {
  const rank = (p: string) =>
    p === 'dbt_project.yml' ? 0 : p.startsWith('models/staging') ? 1 : p.startsWith('models/intermediate') ? 2 : p.startsWith('models/marts') ? 3 : p.startsWith('models') ? 4 : p.startsWith('macros') ? 5 : p.startsWith('tests') ? 6 : 7;
  return Object.keys(files).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
