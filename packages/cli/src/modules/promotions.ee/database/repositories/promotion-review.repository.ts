import type { PromotionReviewState, PromotionReviewTab } from '@n8n/api-types';
import { BaseRepository, type OperationContext, TransactionRunner } from '@n8n/db';
import { Service } from '@n8n/di';
import { DataSource, In, type FindOptionsWhere } from '@n8n/typeorm';

import { PromotionReview } from '../entities/promotion-review.entity';

/** The caller supplies the id, so the review link can exist before the row does. */
export type NewPromotionReview = Pick<PromotionReview, 'id' | 'runId' | 'remoteReviewId'>;

const TERMINAL_STATES: PromotionReviewState[] = ['merged', 'closed'];

/** The run carries the config, the creator, the branch and the commit. */
const WITH_RUN = {
	run: { config: { connection: true }, createdBy: true },
	approvedBy: true,
} as const;

@Service()
export class PromotionReviewRepository extends BaseRepository<PromotionReview> {
	constructor(dataSource: DataSource, transactionRunner: TransactionRunner) {
		super(PromotionReview, dataSource.manager, transactionRunner);
	}

	async insertReview(
		review: NewPromotionReview,
		ctx: OperationContext = {},
	): Promise<PromotionReview> {
		return await this.managerFor(ctx).save(PromotionReview, this.create(review));
	}

	async findByIdWithRelations(id: string): Promise<PromotionReview | null> {
		return await this.findOne({ where: { id }, relations: WITH_RUN });
	}

	/**
	 * Newest first, because the inbox sorts every review kind by creation time.
	 * `id` breaks ties. Reviews can share `createdAt`, and offset pages need a
	 * stable order.
	 */
	async listReviews(options: { tab?: PromotionReviewTab; offset: number; limit: number }) {
		const where: FindOptionsWhere<PromotionReview> = {};
		if (options.tab === 'open') where.state = 'open';
		if (options.tab === 'closed') where.state = In(TERMINAL_STATES);

		const [data, count] = await this.findAndCount({
			where,
			relations: WITH_RUN,
			order: { createdAt: 'DESC', id: 'DESC' },
			skip: options.offset,
			take: options.limit,
		});
		return { count, data };
	}
}
