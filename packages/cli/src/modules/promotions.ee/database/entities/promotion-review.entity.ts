import type { PromotionReviewState } from '@n8n/api-types';
import { DateTimeColumn, generateNanoId, User, WithCreatedAt } from '@n8n/db';
import {
	BeforeInsert,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryColumn,
	type Relation,
} from '@n8n/typeorm';

import { PromotionRun } from './promotion-run.entity';

/**
 * The host review a Promote opened. The host owns the review while it is
 * `open`. n8n owns the state once it is terminal. Title, URL and conflicts are
 * read from the host. Who promoted, and what was pushed, live on the run.
 */
@Entity('promotion_review')
@Index(['state', 'createdAt'])
export class PromotionReview extends WithCreatedAt {
	@PrimaryColumn({ type: 'varchar', length: 36 })
	id: string;

	@BeforeInsert()
	generateId() {
		if (!this.id) this.id = generateNanoId();
	}

	@Index()
	@Column({ type: 'varchar', length: 36 })
	runId: string;

	/**
	 * Opaque reference to the review on the host. The prefix names the host kind
	 * and the host client parses the rest, e.g. `gitlab:<projectId>!<iid>`.
	 */
	@Column({ type: 'varchar', length: 255 })
	remoteReviewId: string;

	@Column({ type: 'varchar', length: 16, default: 'open' })
	state: PromotionReviewState;

	@DateTimeColumn({ nullable: true })
	mergedAt: Date | null;

	@DateTimeColumn({ nullable: true })
	closedAt: Date | null;

	/** The n8n user who approved in n8n. NULL when approval happened on the host. */
	@Column({ type: 'uuid', nullable: true })
	approvedById: string | null;

	@DateTimeColumn({ nullable: true })
	approvedAt: Date | null;

	@ManyToOne(() => PromotionRun, { onDelete: 'CASCADE', nullable: false })
	@JoinColumn({ name: 'runId' })
	run: Relation<PromotionRun>;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'approvedById' })
	approvedBy: Relation<User> | null;
}
