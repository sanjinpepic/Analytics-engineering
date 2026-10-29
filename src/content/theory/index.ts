import type { DomainId, TheoryModule } from '../types';
import { DOMAINS } from '../domains';
import { sqlModule } from './sql';
import { modelingModule } from './modeling';
import { dbtModule } from './dbt';
import { qualityModule } from './quality';
import { semanticModule } from './semantic';
import { warehouseModule } from './warehouse';
import { orchestrationModule } from './orchestration';
import { workflowModule } from './workflow';
import { governanceModule } from './governance';
import { businessModule } from './business';

const byId: Record<DomainId, TheoryModule> = {
  sql: sqlModule,
  modeling: modelingModule,
  dbt: dbtModule,
  quality: qualityModule,
  semantic: semanticModule,
  warehouse: warehouseModule,
  orchestration: orchestrationModule,
  workflow: workflowModule,
  governance: governanceModule,
  business: businessModule,
};

/** Modules in workday order. */
export const THEORY: TheoryModule[] = DOMAINS.map((d) => byId[d.id]);
export const THEORY_BY_ID = byId;
