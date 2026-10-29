import type { TheoryModule } from '../types';

export const businessModule: TheoryModule = {
  id: 'business',
  domain: 'business',
  title: 'Business translation and stakeholder work',
  summary:
    'Turning vague requests into precise metric specs, scoping and communicating work, handling incidents, and knowing DTC and SaaS metrics well enough to define them once and correctly.',
  minutes: 25,
  sections: [
    {
      heading: 'Requirements intake: start from the decision',
      body: `Most bad models are correct answers to the wrong question. Before writing SQL, find out what the number is *for*.

A good intake conversation establishes:

| Question | Why it matters |
|---|---|
| **What decision will this inform?** | "Whether to increase paid social budget" needs channel-level CAC, not a revenue dashboard |
| **Who decides, and who else will see it?** | A board number needs finance sign-off; a growth experiment readout does not |
| **By when?** | A Thursday deadline means a scrappy query now and a robust model later |
| **How precise does it need to be?** | "Is it 10% or 40%?" is a different job from "reconcile to the penny with Stripe" |
| **What will you do differently depending on the answer?** | If nothing, the request may not be worth building |

Stakeholders usually ask for an *output* ("a dashboard of revenue by channel"). Your job is to understand the *outcome* ("decide where to spend next quarter's marketing budget") and propose the smallest thing that serves it.

In practice: write the answers back in two or three sentences ("So you need X to decide Y by Z, and directionally right is fine") and get a thumbs-up. That message becomes the first paragraph of the PR and the model description.`,
    },
    {
      heading: 'From vague ask to metric spec',
      body: `"How much revenue did we make last month?" hides a dozen decisions. At Tidepool:

- **Gross or net?** Before or after discounts? Refunds? Shipping?
- **Which orders?** \`placed\`, \`shipped\`, \`completed\`? \`returned\` and \`cancelled\` excluded? Test accounts?
- **Subscriptions** counted when billed, or recognised monthly?
- **Currency:** convert GBP and EUR at the order-date rate, month-average, or a fixed budget rate? (FX has no weekend rows.)
- **Timezone:** "last month" in UTC or Europe/London? Orders at 23:30 on the 31st move months.
- **Attribution** (if by channel): first touch, last touch? Within what window (7 days, 30 days)?
- **Grain and slicing:** by order date or ship date? By country of the customer or the shipping address?

Write the answers down as a **metric spec** before building:

\`\`\`yaml
metric: net_revenue_usd
owner: finance-analytics
decision: monthly board pack; budget vs actuals
definition: >
  Sum of order item amounts for completed and shipped orders, after discounts,
  minus refunds, excluding shipping, tax and test accounts.
grain: one row per order; aggregated by order_date
time: order_date in Europe/London; month = calendar month
currency: converted to USD at the order date's rate (last business day's rate on weekends and holidays)
includes: [completed, shipped]
excludes: [cancelled, returned, is_test_account, gift card purchases (deferred revenue)]
refunds: subtracted in the month of the original order (restated) # alternative: month refunded
freshness: daily by 07:00 London; last 3 days provisional
reconciles_to: finance's Stripe payout report within 0.5%
\`\`\`

The spec is cheap to change and expensive to skip. Every argument you have later ("why doesn't this match Shopify?") is a line missing from it.

A quick look at how much test accounts matter:

\`\`\`sql run
select
  is_test_account,
  count(*) as orders,
  round(sum(amount_usd), 2) as revenue_usd,
  round(avg(amount_usd), 2) as aov_usd
from prod.fct_orders
where order_status in ('completed', 'shipped')
group by is_test_account;
\`\`\``,
    },
    {
      heading: 'The five questions before you build anything',
      body: `Memorise a short checklist so you ask the same questions every time, even when the request comes as a one-line DM:

1. **What decision does this support, and who makes it?**
2. **What exactly is counted?** Definition, grain, inclusions and exclusions (test accounts, cancellations, refunds).
3. **Over what time, and how fresh?** Period, timezone, date field, how up to date it must be.
4. **How precise, and by when?** Tolerance and deadline; directional now vs exact later.
5. **What must it agree with?** An existing dashboard, finance's numbers, a vendor report. If it will differ, you need to explain why in advance.

**Pushing back without blocking.** You will often get requests that are too big, ill-defined or duplicative. Avoid "no"; offer a path:

- *"I can give you a directional number from existing models today; the full attribution model needs about two weeks. Which do you need for Thursday?"*
- *"We already have \`fct_orders\` net revenue; your number differs because it includes shipping. Want me to add a shipping breakdown rather than build a second revenue model?"*
- *"That would require tracking we don't have (offline promotions). Here is what we can measure, and what it would take to measure the rest."*

Interview pitfall: describing yourself as a ticket-taker ("I build what's asked"). Senior AEs shape the request.`,
    },
    {
      heading: 'MVP vs robust, estimation and uncertainty',
      body: `**MVP vs robust model.** Not every question deserves a tested, documented mart.

| | Ad hoc / MVP | Robust model |
|---|---|---|
| When | One-off decision, exploration, deadline tomorrow | Recurring use, many consumers, feeds a dashboard or sync |
| Form | Saved query or notebook on top of existing marts | dbt model with tests, docs, owner, maybe a contract |
| Risk | Logic copied around if it sticks | Time spent on something used once |

A good rule: the **second** time someone asks for the same logic, it becomes a model.

**Estimating effort.** Break work into: understanding the sources (often the biggest unknown), modelling, tests and docs, validation against an existing number, review and stakeholder sign-off. Give a range, name the main uncertainty ("2 to 5 days; depends on whether refund data in payments is complete"), and re-estimate once you have profiled the data. Validation and reconciliation usually take as long as writing the SQL.

**Communicating uncertainty and caveats.** Put caveats next to the number, not in a footnote nobody reads:

- *"Revenue was $412k (±1%; last 3 days provisional while refunds settle)."*
- *"Mobile conversion is understated for the last few days because mobile events arrive late."*
- *"This excludes subscriptions; including them adds roughly a quarter."* (only if you have actually measured it)

Say what you know, what you don't, and what would change the conclusion. Precision you don't have is worse than a range.`,
    },
    {
      heading: 'Incident communication and written updates',
      body: `When a number is wrong in production, communication quality matters as much as the fix. Stakeholders forgive bugs; they do not forgive finding out from the CFO.

**A good incident update has:**

1. **What is affected** in business terms (which dashboards, metrics, syncs), not model names only.
2. **Impact:** direction and rough size ("revenue overstated by about 8% since Monday"), and whether decisions may have been made on it.
3. **What to do now:** "don't use the channel breakdown until further notice"; "totals are fine".
4. **Status and next update time:** "cause identified, fix in review, next update by 15:00", even if there is nothing new by then.
5. **Owner:** who to ask.

Then a short follow-up after resolution: cause, fix, what was restated, and what prevents recurrence (a new test, a contract, an alert).

**Writing a good Slack update or one-pager.** Lead with the answer (BLUF: bottom line up front), then the evidence, then caveats, then next steps. Use numbers with units and dates. Link the dashboard or query. Keep a one-pager to: question, answer, method in three bullets, caveats, recommendation. If a reader only sees the first two lines, they should still get it right.`,
    },
    {
      heading: 'DTC metric literacy',
      body: `Tidepool sells coffee directly to consumers. The metrics you will be asked about:

| Metric | Definition | Common traps |
|---|---|---|
| **AOV** (average order value) | Net revenue / number of orders | Including test or cancelled orders; mixing currencies; mean skewed by bulk orders (also show median) |
| **Repeat purchase rate** | Customers with 2+ orders / customers with 1+ orders, in a window | Using all signups as the denominator; not giving recent customers time to repeat |
| **Retention cohort** | For customers grouped by first-order month, the share ordering again in month N | Mixing cohorts of different ages in one average |
| **Conversion funnel** | Share of sessions/users progressing view → add to cart → checkout → order | Counting events instead of users; anonymous vs logged-in identity; late mobile events |
| **CAC** (customer acquisition cost) | Marketing spend / new customers acquired, per period or channel | Blended vs paid CAC; partner fees booked on the 1st; attribution window |
| **Contribution margin** | Revenue minus COGS, shipping, payment fees, discounts | Revenue-based "LTV" pretending to be profit |

Repeat purchase rate for non-test customers:

\`\`\`sql run
select
  count(*) filter (where total_orders >= 2) as repeat_customers,
  count(*) filter (where total_orders >= 1) as purchasing_customers,
  round(count(*) filter (where total_orders >= 2) * 1.0
        / nullif(count(*) filter (where total_orders >= 1), 0), 3) as repeat_purchase_rate
from prod.dim_customers
where not is_test_account;
\`\`\`

A first-order-month cohort table (customers active N months after their first order):

\`\`\`sql run
with first_orders as (
  select customer_id, date_trunc('month', min(ordered_at)) as cohort_month
  from prod.fct_orders
  where not is_test_account and order_status in ('completed', 'shipped')
  group by customer_id
),
activity as (
  select distinct
    f.cohort_month,
    f.customer_id,
    date_diff('month', f.cohort_month, date_trunc('month', o.ordered_at)) as months_since_first
  from first_orders f
  join prod.fct_orders o on o.customer_id = f.customer_id
  where not o.is_test_account and o.order_status in ('completed', 'shipped')
)
select cohort_month, months_since_first, count(*) as active_customers
from activity
where cohort_month >= date '2026-01-01'
group by cohort_month, months_since_first
order by cohort_month, months_since_first;
\`\`\``,
    },
    {
      heading: 'SaaS and subscription metrics',
      body: `Tidepool also sells coffee subscriptions, monthly or annual. Subscription metrics are where definitions go wrong most often.

- **MRR (monthly recurring revenue):** the normalised monthly value of active subscriptions at a point in time. An **annual plan contributes its price divided by 12** each month, not the full amount in the month it was billed. **ARR** = MRR × 12 (for subscription revenue only, not one-off orders).
- **MRR movements:** new, expansion, contraction, churned, reactivated. Starting MRR + movements = ending MRR; if it doesn't reconcile, a definition is inconsistent.
- **Churn:** *customer (logo) churn* = customers lost / customers at start of period; *revenue churn* = MRR lost / starting MRR. Decide whether a cancellation counts when requested or when the paid period ends.
- **Net revenue retention (NRR):** MRR this period from customers who were active a year ago / their MRR then. Can exceed 100% with expansion.
- **CAC payback:** CAC / (monthly contribution margin per new customer). "Months to earn back what we paid to acquire them."
- **LTV:** expected *margin* from a customer over their life.

MRR at the end of June 2026, normalising annual plans and converting to USD:

\`\`\`sql run
with fx as (
  select currency, usd_per_unit
  from raw.fx_rates
  where rate_date <= date '2026-06-30'
  qualify row_number() over (partition by currency order by rate_date desc) = 1
)
select
  s.plan,
  count(*) as active_subscriptions,
  round(sum(
    case when s.plan = 'annual' then s.amount_cents / 12.0 else s.amount_cents end
    * case when s.currency = 'USD' then 1.0 else fx.usd_per_unit end
  ) / 100.0, 2) as mrr_usd
from prod.stg_shop__subscriptions s
left join fx on fx.currency = s.currency
where s.started_at <= date '2026-06-30'
  and (s.cancelled_at is null or s.cancelled_at > date '2026-06-30')
group by s.plan
order by s.plan;
\`\`\`

**Why naive LTV misleads.** The classic "AOV × purchase frequency × lifespan" or "ARPU / churn rate":

- uses **revenue, not margin**, so a discounted, expensive-to-ship customer looks valuable;
- assumes **constant churn**, when real retention curves flatten (early churn is high, survivors are loyal), so it can under- or over-state;
- **extrapolates** from young cohorts with little history;
- uses **averages** that hide a heavy-tailed distribution where a few customers drive most value;
- ignores **time value** and the fact that recent cohorts may behave differently (promotions, channel mix).

Better: cohort-based cumulative margin per customer at 3, 6 and 12 months, compared against CAC for the same cohort and channel. It is less impressive in a deck and much harder to get wrong.`,
    },
    {
      heading: 'Funnels, attribution and the identity problem',
      body: `Growth teams live on funnels and attribution, and both hide modelling decisions.

**Funnels.** "Conversion rate" needs a unit (sessions, users, or devices), a window (same session, 7 days) and an ordering rule (must add to cart *before* checkout?). A quick, unordered version over Tidepool's events counts how many devices reached each step at all in May:

\`\`\`sql run
select
  count(distinct case when event_name = 'product_viewed' then anonymous_id end) as viewed_product,
  count(distinct case when event_name = 'add_to_cart' then anonymous_id end) as added_to_cart,
  count(distinct case when event_name = 'checkout_started' then anonymous_id end) as started_checkout,
  count(distinct case when event_name = 'order_completed' then anonymous_id end) as completed_order
from prod.stg_segment__events
where event_ts >= timestamp '2026-05-01'
  and event_ts < timestamp '2026-06-01';
\`\`\`

That is fine for a first look and wrong for a launch decision: one person on phone and laptop is two \`anonymous_id\`s, logged-in users have a \`customer_id\` only after login, and late mobile events mean recent days look worse than they are. A robust funnel model stitches identities (map \`anonymous_id\` to \`customer_id\` once a login is seen), defines sessions, enforces step order, and documents all three choices.

**Attribution.** Which channel gets credit for an order?

- **First touch** credits the channel that brought the customer in; good for acquisition questions.
- **Last touch** credits the final click before purchase; easy, but over-credits branded search and email.
- **Multi-touch / position-based** spreads credit; more realistic, more assumptions.
- Whatever you choose, state the **attribution window** (a touch 60 days ago probably shouldn't count) and keep spend and conversions on the same definition when computing CAC by channel.

In practice, show two attribution models side by side when the decision is about budget. If they agree, the decision is easy; if they disagree, that disagreement is the finding, and it is better surfaced by you than discovered by the CFO.`,
    },
    {
      heading: 'Codify domain logic once',
      body: `The AE's lasting contribution is not answering questions; it is making sure the *next* hundred questions get the same answer. "Partner with domain teams to codify business logic" means:

- **Define flags once, upstream.** \`is_test_account\` lives in \`dim_customers\` and is propagated to \`fct_orders\`. No dashboard re-implements "email ends with tidepool.example".
- **Centralise conversions.** One \`int_orders__fx_converted\` model applies the weekend-rate rule; one \`cents_to_dollars\` macro handles units.
- **Name things for what they mean.** \`net_revenue_usd\` and \`gross_merchandise_value_usd\`, not \`revenue\` and \`revenue2\`.
- **Put metrics in a semantic layer** (dbt Semantic Layer / MetricFlow, LookML, Cube) so BI tools, notebooks and LLM agents compute "MRR" from one definition with consistent filters and time grains.
- **Document the decision**, not just the logic: "refunds are attributed to the original order month, agreed with finance (link)".
- **Make the domain team co-owners.** Finance reviews changes to revenue models; growth reviews attribution. Use groups and code owners so they are asked automatically.

\`\`\`yaml
# MetricFlow-style metric: defined once, used by every tool
metrics:
  - name: net_revenue_usd
    label: Net revenue (USD)
    description: Completed and shipped orders after discounts and refunds, excl. shipping and test accounts.
    type: simple
    type_params:
      measure: net_revenue_usd
    filter: |
      {{ Dimension('order__is_test_account') }} = false
\`\`\`

When three dashboards disagree, the fix is not to correct the dashboards. It is to agree the definition with the business owner, implement it once, point all three at it, and retire the copies.`,
    },
  ],
  keyTerms: [
    { term: 'Metric spec', definition: 'A written definition of a metric: decision, definition, grain, inclusions/exclusions, time, currency, owner and freshness.' },
    { term: 'AOV', definition: 'Average order value: net revenue divided by number of qualifying orders.' },
    { term: 'Repeat purchase rate', definition: 'Share of purchasing customers who placed two or more orders within a window.' },
    { term: 'Retention cohort', definition: 'Customers grouped by first-purchase (or signup) period and tracked over subsequent periods.' },
    { term: 'MRR', definition: 'Monthly recurring revenue: normalised monthly value of active subscriptions; annual plans count at one twelfth per month.' },
    { term: 'ARR', definition: 'Annual recurring revenue, typically MRR × 12 for subscription revenue.' },
    { term: 'Churn', definition: 'Customers (logo churn) or recurring revenue (revenue churn) lost in a period relative to the start.' },
    { term: 'CAC', definition: 'Customer acquisition cost: marketing (and sometimes sales) spend divided by new customers acquired.' },
    { term: 'CAC payback', definition: 'Months of contribution margin needed to recover the cost of acquiring a customer.' },
    { term: 'LTV', definition: 'Lifetime value: expected margin from a customer over their relationship; naive revenue-based formulas often mislead.' },
    { term: 'Attribution window', definition: 'How long after a marketing touch a conversion can be credited to it.' },
    { term: 'BLUF', definition: 'Bottom line up front: lead written updates with the answer, then evidence and caveats.' },
    { term: 'Semantic layer', definition: 'A central place where metrics and dimensions are defined once and queried consistently by many tools.' },
  ],
  landscape: `*Snapshot as of mid-2026.*

- **Semantic layers became strategic.** With LLM agents answering business questions, governed metric definitions moved from nice-to-have to prerequisite. Snowflake launched the Open Semantic Interchange (OSI) initiative in 2025 to standardise how semantic definitions move between tools, and BI and warehouse vendors pushed their own semantic layers harder.
- **Self-serve through natural language.** "Ask the data" assistants in BI tools and Slack, often connected through MCP servers, increased the volume of ad hoc questions. The AE's role shifted towards curating definitions and documentation that make those answers correct, and towards spotting confident-but-wrong answers.
- **Consolidated tooling, same judgement.** Fivetran acquired Census and Tobiko Data (SQLMesh) in 2025, and Fivetran and dbt Labs announced a merger in October 2025. Tools converged; the work of turning a vague question into a precise spec did not get automated.
- **Efficiency focus persisted.** Many companies continued to prioritise profitable growth over growth at any cost, so stakeholders asked more about contribution margin, CAC payback and cohort economics than top-line revenue, which rewards AEs who can model margin, not just revenue.`,
  practice: [
    {
      kind: 'mcq',
      id: 'business.mrr-annual-plan',
      domain: 'business',
      difficulty: 1,
      title: 'Annual plans in MRR',
      prompt: 'A customer buys an annual coffee subscription for $240 on 10 March. How does it contribute to MRR?',
      options: [
        '$240 in March, $0 in the following months',
        '$20 per month for each month the subscription is active',
        '$240 in every month for a year',
        'It is excluded from MRR because it is not monthly',
      ],
      correct: [1],
      explanation: `MRR normalises recurring revenue to a monthly amount, so an annual plan counts at one twelfth per month while active. Booking the full amount in March describes cash or billings, not MRR, and makes MRR spike and crash. Excluding annual plans understates recurring revenue.`,
    },
    {
      kind: 'mcq',
      id: 'business.vague-ask-first-move',
      domain: 'business',
      difficulty: 1,
      title: 'Revenue by channel, please',
      prompt: 'The head of growth DMs: "can you get me revenue by channel?" What is the best first move?',
      options: [
        'Build a dashboard with every channel and every revenue definition so they can pick',
        'Ask what decision it is for, by when, and how precise it needs to be, then confirm a definition (net vs gross, attribution window) in writing',
        'Send the existing revenue dashboard and close the request',
        'Start building last-touch attribution, since it is the industry default',
      ],
      correct: [1],
      explanation: `The decision and deadline determine the right definition and effort. Building everything wastes time and invites inconsistent numbers. The existing dashboard may not have channels at all. Choosing an attribution model without asking embeds a big assumption the stakeholder may disagree with.`,
    },
    {
      kind: 'mcq',
      id: 'business.net-revenue-exclusions',
      domain: 'business',
      difficulty: 2,
      title: 'What belongs in net revenue?',
      prompt: 'Finance defines net revenue as product sales after discounts and refunds. Which should be **excluded** from Tidepool\'s net revenue? Select all that apply.',
      options: [
        'Orders from test accounts',
        'Cancelled orders',
        'Shipping charges',
        'Orders paid with a discount code',
      ],
      correct: [0, 1, 2],
      explanation: `Test accounts and cancelled orders are not real sales, and shipping is excluded by finance's definition (product sales). Discounted orders are real sales; the discount is subtracted from the amount, but the order is included.`,
    },
    {
      kind: 'mcq',
      id: 'business.repeat-rate-denominator',
      domain: 'business',
      difficulty: 2,
      title: 'Repeat purchase rate looks terrible',
      prompt: 'A dashboard shows a 12% repeat purchase rate, computed as customers with 2+ orders divided by all signups in `dim_customers`. Why is this likely misleading?',
      options: [
        'The denominator includes signups who never purchased; it should be customers with at least one order (and test accounts excluded)',
        'Repeat purchase rate should use orders, not customers, in the numerator',
        'It should be computed on `raw.customers` because CDC history is more complete',
        'It is correct; all signups are potential repeat purchasers',
      ],
      correct: [0],
      explanation: `Repeat rate asks "of people who bought, how many came back?". Non-purchasers dilute it. Counting orders instead of customers measures frequency, a different metric. Raw CDC history contains multiple versions per customer and would inflate counts. Also give recent first-time buyers a fair window before counting them as non-repeaters.`,
    },
    {
      kind: 'mcq',
      id: 'business.naive-ltv',
      domain: 'business',
      difficulty: 3,
      title: 'Why the LTV slide is wrong',
      prompt: 'Marketing presents LTV = AOV × average orders per year × 3 years, computed over all customers, and compares it to paid CAC. Which criticisms are valid? Select all that apply.',
      options: [
        'It uses revenue rather than contribution margin, overstating value',
        'It assumes a 3-year lifespan instead of measuring retention by cohort',
        'Comparing an all-customer average to paid CAC mixes organic customers into the value side',
        'LTV should never be compared to CAC',
      ],
      correct: [0, 1, 2],
      explanation: `Revenue ignores COGS, shipping and discounts; an assumed lifespan replaces evidence with a guess; and organic customers inflate the average LTV relative to customers bought through paid channels. Comparing LTV with CAC is legitimate when both are measured on the same cohort and channel and LTV is margin-based.`,
    },
    {
      kind: 'mcq',
      id: 'business.cac-payback',
      domain: 'business',
      difficulty: 2,
      title: 'Blended vs paid CAC',
      prompt: `In May, Tidepool spent $50k on paid marketing and acquired 1,000 new customers, 400 of them via paid channels. Monthly contribution margin per new customer is about $10. Which statement is right?`,
      options: [
        'CAC is $50 and payback is 5 months, regardless of channel',
        'Blended CAC is $50 (payback ~5 months); paid CAC is $125 (payback ~12.5 months). For budget decisions on paid channels, paid CAC is the relevant one',
        'Paid CAC is $20 because spend is divided by all customers',
        'Payback cannot be computed without LTV',
      ],
      correct: [1],
      explanation: `Blended CAC (spend / all new customers) flatters paid channels by counting organic customers. For "should we spend more on paid", use spend / paid-acquired customers, with an agreed attribution window. Payback = CAC / monthly margin per customer; it doesn't need LTV.`,
    },
    {
      kind: 'mcq',
      id: 'business.pushback-deadline',
      domain: 'business',
      difficulty: 2,
      title: 'Thursday deadline, two-week model',
      prompt: 'The CMO wants a multi-touch attribution model for Thursday\'s budget meeting. Properly built, it is about two weeks of work. What do you do?',
      options: [
        'Agree to Thursday and work late, skipping tests',
        'Decline because the timeline is unrealistic',
        'Offer a directional answer for Thursday from existing data (e.g. last-touch and first-touch side by side with caveats), and a plan and date for the robust model',
        'Build a quick multi-touch model and present it as final',
      ],
      correct: [2],
      explanation: `Pushing back without blocking: serve the decision with what is reliable now, be explicit about limitations, and schedule the robust version. Rushing an untested model risks a bad budget decision; declining helps nobody; presenting a hack as final damages trust when it changes.`,
    },
    {
      kind: 'mcq',
      id: 'business.incident-first-message',
      domain: 'business',
      difficulty: 1,
      title: 'First incident message',
      prompt: 'You discover the revenue dashboard has double-counted orders since Monday. What should the first stakeholder message contain?',
      options: [
        'A detailed technical root-cause analysis once you have finished investigating',
        'What is affected, rough impact and direction, what not to use for now, and when the next update will come',
        'An apology and nothing else until it is fixed',
        'Nothing; fix it quietly before anyone notices',
      ],
      correct: [1],
      explanation: `Early, short, actionable messages stop people making decisions on bad numbers. Root cause can follow. Silence or a vague apology leaves stakeholders guessing, and quiet fixes erode trust when discovered.`,
    },
    {
      kind: 'mcq',
      id: 'business.cohort-mix-shift',
      domain: 'business',
      difficulty: 3,
      title: 'Retention is falling, or is it?',
      prompt: `Overall 90-day repeat rate dropped from 30% to 24% over two quarters. Over the same period, a large discount campaign brought in many new customers through partner channels. Every monthly cohort's retention curve, split by channel, is roughly unchanged. What is the best explanation?`,
      options: [
        'Product quality declined, causing all customers to churn more',
        'Mix shift: a larger share of customers came from a lower-retention channel, pulling the blended average down while each segment is stable',
        'The cohort analysis is wrong because cohorts should be by signup date',
        'Late-arriving events are hiding repeat orders',
      ],
      correct: [1],
      explanation: `When every segment is stable but the total moves, the composition changed. Report retention by cohort and channel, and frame the decision as "are partner-channel customers worth their CAC?" rather than "retention is collapsing". A genuine quality issue would show up within segments. Orders come from the shop database, not late mobile events.`,
    },
    {
      kind: 'mcq',
      id: 'business.define-once',
      domain: 'business',
      difficulty: 3,
      title: 'Three dashboards, three numbers',
      prompt: 'The finance, growth and CX dashboards each show a different number of "active customers". What is the most durable fix?',
      options: [
        'Pick the largest number since it is most inclusive',
        'Add a footnote to each dashboard explaining its definition',
        'Agree one definition with a named business owner, implement it once (model or semantic-layer metric), point all dashboards at it, and give genuinely different concepts distinct names',
        'Ask each team to rename their metric so they no longer clash',
      ],
      correct: [2],
      explanation: `Codifying the definition once ends the argument at the source; distinct concepts (e.g. "active subscribers" vs "customers who ordered in 90 days") get distinct names rather than sharing one. Footnotes keep three definitions alive. Renaming alone avoids the conversation about which one the company should steer by.`,
    },
    {
      kind: 'order',
      id: 'business.request-lifecycle',
      domain: 'business',
      difficulty: 1,
      title: 'From request to trusted metric',
      prompt: 'Order the steps for handling a new metric request.',
      steps: [
        'Clarify the decision, owner, deadline and precision needed',
        'Write a metric spec (definition, grain, inclusions/exclusions, time, currency) and get sign-off',
        'Profile the sources and estimate effort with the main uncertainty named',
        'Build the model or metric with tests and docs',
        'Reconcile against an existing or external number and explain differences',
        'Ship with caveats stated and announce where the definition lives',
      ],
      explanation: `Understanding comes before definition, definition before estimation (you cannot estimate a vague ask), and validation before shipping. Announcing where the definition lives is what stops it being re-implemented elsewhere.`,
    },
    {
      kind: 'open',
      id: 'business.clarifying-questions',
      domain: 'business',
      difficulty: 2,
      title: 'Clarify a vague request',
      prompt: `The CEO messages: "What's our churn? Need it for the investor update." Tidepool has one-off orders and monthly/annual subscriptions in several currencies. Write the clarifying questions (or the short reply) you would send before building anything.`,
      rubric: [
        'Asks what the number is for and who will see it (investor update: needs consistency with finance, possibly with prior reported figures)',
        'Distinguishes subscription churn from one-off customer lapse, and logo churn from revenue (MRR) churn',
        'Asks about period and the cancellation timing rule (request vs end of paid period) and annual plans',
        'Covers exclusions (test accounts, paused subscriptions, reactivations) and currency/normalisation for revenue churn',
        'Asks about deadline and precision, and proposes a default definition to react to rather than only asking',
        'Concise and easy for a busy executive to answer',
      ],
      sampleAnswer: `Happy to. Three quick questions so it matches what investors expect: (1) Subscription churn or all customers? For subscriptions I'd report monthly logo churn (subscribers who cancelled / subscribers at start of month) and revenue churn on MRR, with annual plans counted at 1/12 per month in USD. One-off buyers don't "churn" cleanly, so I'd show 90-day repeat rate separately. (2) Which period: last month, last quarter averaged, or trailing 12 months? Has a churn figure gone to investors before? If so I'll match that method. (3) When do you need it, and is ±0.5pt fine? Unless you say otherwise I'll count a cancellation when the paid period ends, exclude test accounts, and treat a resubscription within 30 days as not churned. I can have a first number in front of you tomorrow morning.`,
      minWords: 60,
      placeholder: 'Quick questions before I pull this...',
    },
    {
      kind: 'open',
      id: 'business.incident-slack-update',
      domain: 'business',
      difficulty: 2,
      title: 'Write the incident update',
      prompt: `At 10:15 you find that since Monday's deploy, re-delivered order rows were not deduplicated, so \`fct_orders\` contains duplicates. The exec revenue dashboard is overstated by roughly 6% for Monday to today (Wednesday). The fix is a one-line change and a rebuild, about 2 hours. Marketing used the channel dashboard this morning to shift budget. Write the Slack update to #data-announcements.`,
      rubric: [
        'Leads with what is affected in business terms (which dashboards/metrics, date range) and the direction and size of impact',
        'Says clearly what people should and should not use right now',
        'Flags that decisions may have been made on the bad data (marketing budget) and offers to follow up directly',
        'Gives status and an ETA plus a time for the next update, and names an owner',
        'Avoids blame and jargon; short, scannable',
        'Promises a follow-up with cause and prevention (e.g. uniqueness test) after resolution',
      ],
      sampleAnswer: `Data issue: revenue overstated Mon–Wed. The exec revenue and channel dashboards show order revenue about 6% too high for Monday 00:00 to now, because some orders were counted twice after Monday's change. Data before Monday is correct. Please don't use revenue, AOV or channel figures for Mon–Wed until the fix is out; order counts in the same range are also inflated. @marketing: you shifted budget this morning based on the channel dashboard, so I'll send you corrected channel numbers directly as soon as they're rebuilt. Status: cause found, fix in review, rebuild running. ETA about 12:30; I'll post here by 12:30 either way. Owner: me. Afterwards I'll share what happened and the test we're adding so duplicates fail the build instead of reaching dashboards.`,
      minWords: 60,
      placeholder: 'Data issue: ...',
    },
  ],
};
