import { costStatistics, type UsageRecords } from '../../../domain/core/usage/codexUsage';
export interface UsageStatisticsStore { readRecords(since: number): UsageRecords }
export class UsageStatisticsService {
  constructor(private store: UsageStatisticsStore) {}
  read() { return costStatistics(this.store.readRecords(Date.now() - 28 * 86400_000)); }
}
